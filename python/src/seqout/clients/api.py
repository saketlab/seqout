import contextlib
import hashlib
import logging
from collections import Counter
import datetime
import functools
import itertools
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import (
    Future,
    ThreadPoolExecutor,
    as_completed,
)
from pathlib import Path
from typing import Any, Literal, Self, TypeVar

import requests

from seqout.exception import SeqoutError
from seqout.constants import (
    API_BASE_URL,
    DEFAULT_DOWNLOAD_CHUNK_SIZE,
    DEFAULT_MAX_WAIT,
    DEFAULT_NUM_RETRIES,
    DEFAULT_REQ_TIMEOUT,
)
from seqout.dataset import (
    _EXP_PREFIXES,
    _RUN_PREFIXES,
    _SAMPLE_PREFIXES,
    _STUDY_PREFIXES,
    ShortNames,
)
from seqout.helpers import (
    _download_file,
    _send_req,
)
from seqout.search_plan import SearchPlan, apply_plan, plan_search
from seqout.models.api_models import (
    AccessionClassification,
    AuthorProjectsResponse,
    ExperimentRunsResponse,
    ExperimentSampleList,
    GeoSampleDetailedMetadata,
    ProjectCrossReferenceList,
    ProjectCrossReferenceResponse,
    ProjectLLMEnrichedSampleMetadataResponse,
    ProjectLLMEnrichedSampleMetadataResults,
    ProjectMetadataResult,
    ProjectSummaryResult,
    ProjectSummaryResultList,
    PublicationLookupResult,
    SampleDetailedMetadata,
    SampleMetadataResult,
    SearchCorrection,
    SearchParams,
    SearchResponse,
    BamFile,
    BamFiles,
    BamsResponse,
    SearchTotal,
    SearchResult,
    SearchResults,
    StructuredSearchParams,
    StudyExperimentsResults,
    StudyRunsResponse,
    StudyRunsResult,
    StudyRunsResults,
)
from seqout.models.parquet_models import Study
from seqout.utils import (
    _extract_download_info_for_study_run,
    _normalize_num_workers,
    _normalize_url,
    _validate_study_runs_data,
)

logger = logging.getLogger(__name__)

SearchParamsType = SearchParams | StructuredSearchParams
_NOT_FOUND = 404
T = TypeVar("T")


def _md5_matches(path: Path, want: str) -> bool:
    seen = hashlib.md5()  # noqa: S324 - the archive publishes md5, not a choice
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            seen.update(block)
    return seen.hexdigest().lower() == want.strip().lower()


def _unique_bam_names(bams: list[BamFile]) -> list[str]:
    """Submitters name their own files, so two runs can send the same name."""
    names = [b.filename or f"{b.run_accession}.bam" for b in bams]
    seen = Counter(names)
    return [
        f"{b.run_accession}_{name}" if seen[name] > 1 and b.run_accession else name
        for b, name in zip(bams, names, strict=True)
    ]


def _as_plan(
    params: SearchParamsType | str | None, filters: dict[str, Any]
) -> SearchPlan:
    """
    Let the search calls take a bare query string plus keyword filters.

    search("liver", organism="Homo sapiens") and the original
    search(SearchParams(...)) both work. Given filters, the endpoint is chosen
    from them and anything it cannot do is left for the client -- see
    seqout.search_plan. A params object built by hand is sent as it is, since
    the caller has already chosen.
    """
    if isinstance(params, str):
        return plan_search(params, **filters)
    if params is None:
        return plan_search(None, **filters)
    return SearchPlan(
        params=params, structured_endpoint=isinstance(params, StructuredSearchParams)
    )


class SeqoutAPIClient(ShortNames):
    def __init__(
        self,
        base_url: str = API_BASE_URL,
        timeout: int = DEFAULT_REQ_TIMEOUT,
        num_retries: int = DEFAULT_NUM_RETRIES,
        max_wait: int = DEFAULT_MAX_WAIT,
    ) -> None:
        """Initialize the API client with connection settings."""
        self._base_url = base_url
        self._timeout = timeout
        self._num_retries = num_retries
        self._max_wait = max_wait

        self._req_builder = functools.partial(
            _send_req,
            timeout=self._timeout,
            num_retries=self._num_retries,
            max_wait=self._max_wait,
        )
        self._downloader = functools.partial(
            _download_file,
            num_retries=self._num_retries,
            timeout=self._timeout,
            max_wait=self._max_wait,
        )

        self._sender = functools.partial(
            self._req_builder,
            method="GET",
        )
        self._poster = functools.partial(
            self._req_builder,
            method="POST",
        )

    # /search/facets counts the same match set, and its `q` is required, so a
    # filter-only search has no cheap total. Everything else it takes is a
    # subset of SearchParams.
    _COUNTABLE = frozenset(
        {
            "q", "db", "structured", "organism", "country", "library_strategy",
            "library_source", "instrument_model", "platform", "journal",
            "multi_platform", "date_from", "date_to",
        }
    )

    def _search_total(self, params: SearchParamsType) -> int | None:
        """The exact number of matches, or None when it cannot be had cheaply.

        The structured endpoint sends a total with the results, so this is only
        for the full-text one, which defers its count to /search/facets.
        """
        if isinstance(params, StructuredSearchParams):
            return None
        sent = params.model_dump(exclude_none=True, by_alias=True)
        if not sent.get("q"):
            return None
        try:
            return self._sender(
                url=f"{self._base_url}/search/facets",
                params={k: v for k, v in sent.items() if k in self._COUNTABLE},
                response_model=SearchTotal,
            ).total
        except Exception:
            return None  # a count is a nicety; never fail the search for it

    def _fetch_search_page(
        self,
        params: SearchParamsType,
    ) -> SearchResponse:
        is_structured = isinstance(params, StructuredSearchParams)
        params_dict = (
            None
            if params is None
            else params.model_dump(exclude_none=True, by_alias=True)
        )

        return self._sender(
            url=f"{self._base_url}/search"
            if not is_structured
            else f"{self._base_url}/search/structured",
            params=params_dict,
            response_model=SearchResponse,
        )

    def _iter_search_pages(
        self,
        params: SearchParamsType,
        first: SearchResponse | None = None,
    ) -> Iterator[SearchResult]:
        # Reuse page 0 when a caller already fetched its spelling correction.
        response = first if first is not None else self._fetch_search_page(params)
        while True:
            yield from response.results

            if not response.next_cursor:
                break

            update = {"cursor_acc": response.next_cursor.accession}
            if response.next_cursor.sort_value is not None:
                update["cursor_sort"] = response.next_cursor.sort_value
            else:
                update["cursor_rank"] = response.next_cursor.rank
            params = params.model_copy(update=update)
            response = self._fetch_search_page(params)

    def _search_with_correction(
        self,
        params: SearchParamsType | str | None = None,
        **filters: Any,
    ) -> tuple[SearchCorrection | None, int | None, Iterator[SearchResult]]:
        """
        Page 0's correction and total, plus a lazy iterator over every result.

        The correction (did you mean / augmented extra matches) only rides on
        the first page; this reuses that page so paging costs no extra request.
        `total` is the server's exact count where it sends one -- the full-text
        endpoint defers it to /search/facets and sends None, so the caller
        counts instead. Internal: the command line needs both and pages by
        hand, but a library caller wants `search`, which reads to the end.
        """
        plan = _as_plan(params, filters)
        # The count is a second request, so it rides alongside page 0 rather
        # than after it: the wait is the slower of the two, not their sum.
        with ThreadPoolExecutor(max_workers=2) as pool:
            page = pool.submit(self._fetch_search_page, plan.params)
            count = pool.submit(self._search_total, plan.params)
            first, total = page.result(), count.result()
        rows = self._iter_search_pages(plan.params, first=first)
        if plan.has_local_work:
            rows = iter(apply_plan(rows, plan))
        return first.correction, total if total is not None else first.total, rows

    def search(
        self,
        params: SearchParamsType | str | None = None,
        limit: int | None = None,
        **filters: Any,
    ) -> SearchResults:
        """
        Search for projects. Every match, not the first page.

        Takes a query string with keyword filters, or a params object. The
        server answers 200 rows at a time and this follows the cursor to the
        end, so a broad query costs several requests -- give `limit` when a
        sample of the results is enough.
        """
        plan = _as_plan(params, filters)
        rows: Iterable[SearchResult] = self._iter_search_pages(plan.params)
        if plan.has_local_work:
            # A row dropped or reordered here has to move before `limit` counts.
            rows = apply_plan(rows, plan)
        if limit is not None:
            rows = itertools.islice(rows, limit)
        return SearchResults(list(rows))

    def bulk_search(
        self,
        params: list[SearchParamsType],
        num_workers: int | None = None,
    ) -> dict[int, SearchResults]:
        """Run several searches in parallel, keyed by their index in params."""
        num_workers = _normalize_num_workers(num_workers)

        def _do_search(params: SearchParamsType) -> SearchResults:
            return self.search(params)

        with ThreadPoolExecutor(max_workers=num_workers) as pool:
            futures: dict[Future[SearchResults], int] = {
                pool.submit(_do_search, p): i for i, p in enumerate(params)
            }
            results: dict[int, SearchResults] = {}

            for f in as_completed(futures):
                idx = futures[f]
                results[idx] = f.result()

        return results

    def fetch_project_summary(self, accession_id: str) -> ProjectSummaryResult:
        """Fetch the short project record: title, organisms, dates, counts."""
        return self._sender(
            url=f"{self._base_url}/project/{accession_id}/metadata",
            response_model=ProjectSummaryResult,
        )

    def bulk_fetch_project_summary(
        self, accession_ids: list[str]
    ) -> ProjectSummaryResultList:
        """Fetch short project records for many accessions in one request."""
        return self._poster(
            url=f"{self._base_url}/bulk/project-metadata",
            response_model=ProjectSummaryResultList,
            json={"accessions": accession_ids},
        )

    def fetch_project_metadata(self, accession_id: str) -> ProjectMetadataResult:
        """Fetch the full project record, including its supplementary files."""
        return self._sender(
            url=f"{self._base_url}/project/{accession_id}",
            response_model=ProjectMetadataResult,
        )

    def fetch_samples(self, accession_id: str) -> ExperimentSampleList:
        """
        Fetch the sample records of a GEO series or ArrayExpress experiment.

        Raises:
            ValueError: If the accession names anything else. A sequence archive
                study has experiments, not samples; use fetch_study_experiments.

        """
        if not accession_id.startswith("GSE") and not accession_id.startswith("E-"):
            msg = (
                "samples can be only fetched for GEO series and"
                " ArrayExpress experiments"
            )
            raise ValueError(msg)

        return self._sender(
            url=f"{self._base_url}/geo/series/{accession_id}/samples",
            response_model=ExperimentSampleList,
        )

    def fetch_cross_references(self, accession_id: str) -> ProjectCrossReferenceList:
        """Fetch the accessions other archives record for the same data."""
        response = self._sender(
            url=f"{self._base_url}/project/{accession_id}/xref",
            response_model=ProjectCrossReferenceResponse,
        )

        return response.xref

    def fetch_project_enriched_metadata(
        self, accession_id: str
    ) -> ProjectLLMEnrichedSampleMetadataResults:
        """
        Fetch the structured per-sample labels seqout.org has prepared.

        Coverage is partial. A project that has not been processed answers 404,
        which comes back as an empty result.
        """
        try:
            response = self._sender(
                url=f"{self._base_url}/project/{accession_id}/enriched",
                response_model=ProjectLLMEnrichedSampleMetadataResponse,
            )
        except requests.exceptions.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == _NOT_FOUND:
                return ProjectLLMEnrichedSampleMetadataResults([])
            raise

        return response.samples

    def fetch_study_experiments(self, study_id: str) -> StudyExperimentsResults:
        """Fetch the library preparations of a study."""
        return self._sender(
            url=f"{self._base_url}/project/{study_id}/experiments",
            response_model=StudyExperimentsResults,
        )

    def fetch_study_runs(
        self, study_id: str, *, full: bool = False
    ) -> StudyRunsResults:
        """
        Fetch the sequencing runs of a study, with their file URLs.

        Args:
            study_id: A study accession, such as SRP310139 or PRJNA1458007.
            full: Read every run. The default is the backend's 500-run preview,
                which is enough to inspect a study but not to download one.

        """
        response = self._sender(
            url=f"{self._base_url}/project/{study_id}/runs",
            params={"full": "true"} if full else None,
            response_model=StudyRunsResponse,
        )

        return response.runs

    def classify_accession(self, accession_id: str) -> AccessionClassification:
        """Ask the API what an accession is and which source holds it."""
        return self._sender(
            url=f"{self._base_url}/accession/{accession_id}/classify",
            response_model=AccessionClassification,
        )

    def fetch_run(self, run_id: str) -> StudyRunsResult:
        """Fetch one run, with its file URLs, sizes and checksums."""
        return self._sender(
            url=f"{self._base_url}/run/{run_id}",
            response_model=StudyRunsResult,
        )

    def fetch_experiment_runs(self, experiment_id: str) -> StudyRunsResults:
        """List the runs of one experiment (SRX/ERX/DRX/CRX/HRX)."""
        response = self._sender(
            url=f"{self._base_url}/experiment/{experiment_id}/runs",
            response_model=ExperimentRunsResponse,
        )
        return response.runs

    # Method names match SeqoutParquetClient for backend-neutral CLI paths.

    def _quiet(self, fn: Callable[[], T], /) -> T | None:
        """Run a lookup that is allowed to miss; a miss is not an error here."""
        try:
            return fn()
        except Exception:
            return None

    def resolve_study(self, accession: str) -> str | None:
        """
        Resolve a child accession (run/experiment/sample) to its study root.

        No single endpoint answers this for every archive, so the exact lookups
        are tried first and full-text search is the last resort:

        =========== ================================================
        run         /run/{acc} carries study_accession (SRA, DDBJ)
        experiment  /sample-detail/{acc} (GSA), else its first run
        sample      /sample-detail/{acc} carries the project
        anything    search, works when the accession is FTS-indexed
        =========== ================================================
        """
        if accession.upper().startswith(_STUDY_PREFIXES):
            return accession
        return self._study_by_lookup(accession) or self._study_by_search(accession)

    def _study_by_lookup(self, accession: str) -> str | None:
        """Ask the endpoint that knows, chosen by what the accession names."""
        up = accession.upper()
        if up.startswith(_RUN_PREFIXES):
            run = self._quiet(lambda: self.fetch_run(accession))
            return run.study_accession if run is not None else None
        if up.startswith(_EXP_PREFIXES):
            # GSA answers on sample-detail; SRA/DDBJ only via one of its runs.
            found = self._project_from_sample_detail(accession)
            if found:
                return found
            runs = self._quiet(lambda: self.fetch_experiment_runs(accession))
            return self.resolve_study(runs[0].run_accession) if runs else None
        if up.startswith(_SAMPLE_PREFIXES):
            return self._project_from_sample_detail(accession)
        return None

    def _study_by_search(self, accession: str) -> str | None:
        """Last resort; works only when the accession is full-text indexed."""
        res = self._quiet(lambda: self.search(SearchParams(q=accession)))
        return next(
            (
                r.accession
                for r in res or []
                if r.accession.upper().startswith(_STUDY_PREFIXES)
            ),
            None,
        )

    def _project_from_sample_detail(self, accession: str) -> str | None:
        # GEO sample-detail is channel-shaped, unlike the other archives.
        fetch = (
            self.fetch_geo_sample_detailed_metadata
            if accession.upper().startswith("GSM")
            else self.fetch_sample_detailed_metadata
        )
        detail = self._quiet(lambda: fetch(accession))
        if detail is None or detail.project is None:
            return None
        return detail.project.accession or None

    def linked_study(self, accession: str) -> str | None:
        """
        Return a series' linked sequencing study, the route to its runs.

        Cross-references answer for GEO and ArrayExpress. GEA (E-GEAD-N) files
        no cross-reference at all and names its data only as a BioProject in the
        project record, so that is tried next.
        """
        xref = self._quiet(lambda: self.fetch_cross_references(accession)) or []
        cands = [
            r.accession for r in xref if r.accession.upper().startswith(_STUDY_PREFIXES)
        ]
        for c in cands:  # prefer a real study accession over a BioProject
            if c.upper().startswith(("SRP", "ERP", "DRP")):
                return c
        if cands:
            return cands[0]
        meta = self._quiet(lambda: self.fetch_project_metadata(accession))
        return meta.bioproject if meta is not None else None

    def linked_geo(self, accession: str) -> str | None:
        """Return an SRA/ENA study's linked GEO series / ArrayExpress, via xref."""
        try:
            cands = [
                r.accession
                for r in self.fetch_cross_references(accession)
                if r.accession.upper().startswith(("GSE", "E-"))
            ]
        except Exception:
            return None
        return cands[0] if cands else None

    def gsm_series(self, gsm: str) -> str | None:
        """Return the GEO series (GSE) a GEO sample (GSM) belongs to."""
        try:
            detail = self.fetch_geo_sample_detailed_metadata(gsm)
        except Exception:
            return None
        return detail.project.accession if detail.project else None

    def search_author_projects(
        self, name: str, limit: int = 200
    ) -> AuthorProjectsResponse:
        """
        List every dataset an author is linked to through its publications.

        Args:
            name: The author name as it appears in the publication record.
            limit: Maximum datasets to return.

        """
        return self._sender(
            url=f"{self._base_url}/author/projects",
            params={"q": name, "limit": limit},
            response_model=AuthorProjectsResponse,
        )

    def find_publication(
        self, *, pmid: str | None = None, doi: str | None = None
    ) -> PublicationLookupResult:
        """
        Look a publication up by PubMed ID or DOI and list the projects it names.

        A publication seqout does not hold comes back as an empty result.
        """
        params = {"pmid": pmid} if pmid else {"doi": doi}
        try:
            return self._sender(
                url=f"{self._base_url}/publication",
                params=params,
                response_model=PublicationLookupResult,
            )
        except requests.exceptions.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == _NOT_FOUND:
                return PublicationLookupResult()
            raise

    def fetch_sample_metadata(self, sample_id: str) -> SampleMetadataResult:
        """Fetch one sample record."""
        return self._sender(
            url=f"{self._base_url}/sample/{sample_id}",
            response_model=SampleMetadataResult,
        )

    def fetch_sample_detailed_metadata(self, sample_id: str) -> SampleDetailedMetadata:
        """Fetch one sample with every field the archive holds."""
        return self._sender(
            url=f"{self._base_url}/sample-detail/{sample_id}",
            response_model=SampleDetailedMetadata,
        )

    def fetch_geo_sample_detailed_metadata(
        self, sample_id: str
    ) -> GeoSampleDetailedMetadata:
        """Fetch one GSM, including the supplementary files it carries."""
        return self._sender(
            url=f"{self._base_url}/sample-detail/{sample_id}",
            response_model=GeoSampleDetailedMetadata,
        )

    def fetch_study(self, accession: str) -> Study:
        """
        Fetch one study: title, abstract, organisms, publication and counts.

        library_strategies, assay_l1, assay_l2 and num_experiments come back
        None. The REST API does not carry them; connect("parquet") does.
        """
        meta = self.fetch_project_metadata(accession)

        design = meta.overall_design
        if isinstance(design, list):  # GEA sends a list of protocols
            design = "\n".join(design)
        published_at = None
        if meta.published_at:
            with contextlib.suppress(ValueError):
                published_at = datetime.date.fromisoformat(meta.published_at[:10])

        return Study(
            accession=meta.accession,
            title=meta.title,
            description=meta.summary,
            overall_design=design,
            pubmed_id=meta.pmid or (meta.pubmed_ids[0] if meta.pubmed_ids else None),
            journal=meta.journal,
            citation_count=meta.citation_count,
            aliases=meta.alias,
            organisms=list(meta.organisms or []),
            num_samples=len(meta.samples_ref),
            center_names=[meta.center_name] if meta.center_name else [],
            is_single_cell=bool(meta.is_single_cell),
            single_cell_modality=meta.single_cell_modality,
            published_at=published_at,
        )

    def _download_many(
        self,
        url_to_dest: dict[str, Path],
        num_workers: int | None,
        chunk_size: int,
        *,
        with_pbar: bool,
        md5s: dict[str, str] | None = None,
    ) -> None:
        num_workers = _normalize_num_workers(num_workers)

        def fetch(url: str, dest_path: Path) -> None:
            self._downloader(
                url=url, dest_path=dest_path, chunk_size=chunk_size,
                with_pbar=with_pbar,
            )
            want = (md5s or {}).get(url)
            if want and not _md5_matches(dest_path, want):
                # A corrupt alignment is worse than a missing one: it reads.
                dest_path.unlink(missing_ok=True)
                msg = f"checksum mismatch for {dest_path.name}; deleted"
                raise SeqoutError(msg)

        with ThreadPoolExecutor(num_workers) as pool:
            futures = {
                pool.submit(fetch, url, dest_path): url
                for url, dest_path in url_to_dest.items()
            }
            for f in as_completed(futures):
                f.result()

    def fetch_bams(self, accession: str) -> BamFiles:
        """
        The alignment files a submitter sent for a study.

        Not the reads: these are the submitter's own BAMs, aligned to a
        reference they chose, and they often carry work the reads alone do not
        reconstruct -- barcode tags, methylation calls, long-read structural
        evidence.

        Read this before downloading. A study can run to hundreds of gigabytes,
        and most files are in requester-pays storage that no anonymous client
        can fetch; `BamFiles.requester_pays` names those.
        """
        return self._sender(
            url=f"{self._base_url}/project/{accession}/bams",
            response_model=BamsResponse,
        ).to_files()

    def download_bams(
        self,
        accession: str,
        out_dir: Path,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = True,
    ) -> list[Path]:
        """
        Download the alignment files a study's submitter sent.

        The files behind requester-pays storage are named rather than fetched,
        with the command that would get them, so a study that is partly open
        still yields what it can.

        Submitters name their own files, so two runs can send the same name;
        those are prefixed with the run accession to keep them apart.

        Takes any accession: a study downloads all of its alignments, an
        experiment or run only its own.
        """
        bams = self.get(accession).bams
        if not bams.root:
            logger.warning("%s has no submitted alignment files", accession)
            return []

        paid = bams.requester_pays
        if paid:
            example = next((b.s3_url for b in paid if b.s3_url), None)
            logger.warning(
                "%d of %d alignment file(s) are in requester-pays storage and "
                "cannot be fetched anonymously.%s The full list, with sizes and "
                "checksums, is fetch_bams(%r).",
                len(paid),
                len(bams.root),
                f" Reading them bills your own account: "
                f"aws s3 cp --request-payer requester {example} ."
                if example
                else "",
                accession,
            )

        open_files = bams.openly_readable
        if not open_files:
            return []

        out_dir.mkdir(parents=True, exist_ok=True)
        names = _unique_bam_names(open_files)
        url_to_dest = {
            _normalize_url(b.open_url): out_dir / name
            for b, name in zip(open_files, names, strict=True)
        }
        self._download_many(
            url_to_dest,
            num_workers,
            chunk_size,
            with_pbar=with_pbar,
            md5s={
                _normalize_url(b.open_url): b.md5
                for b in open_files
                if b.md5
            },
        )
        return list(url_to_dest.values())

    def fetch_citations(
        self,
        accession: str,
        type: Literal["original", "all"] = "original",
    ) -> str:
        """
        BibTeX for the papers behind a dataset.

        The archive holds the link from a dataset to its paper, so the entry is
        assembled from the record rather than looked up by hand. `type="all"`
        adds the papers that reanalysed the data afterwards.

        A dataset with no linked paper answers with an empty string, not an
        error, so a loop over many accessions does not stop at the first gap.
        """
        try:
            return self._sender(
                url=f"{self._base_url}/project/{accession}/cite",
                params={"type": type, "format": "bibtex"},
            )
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                return ""  # "no publications found" is an answer, not a failure
            raise

    def download_project_supplementary_data(
        self,
        metadata: ProjectMetadataResult,
        out_dir: Path,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ) -> None:
        """
        Download a project's supplementary files into out_dir.

        Args:
            metadata: The project record, from fetch_project_metadata.
            out_dir: Created if it does not exist.
            num_workers: Parallel downloads. Defaults to the core count less two.
            chunk_size: Bytes per read from the socket.
            with_pbar: Show a per-file progress bar.

        """
        num_workers = _normalize_num_workers(num_workers)
        out_dir.mkdir(parents=True, exist_ok=True)

        url_to_dest: dict[str, Path] = {}

        for url, _ in metadata.supplementary_data:
            normalized_url = _normalize_url(url)
            url_to_dest[normalized_url] = out_dir / Path(normalized_url.split("/")[-1])

        with ThreadPoolExecutor(num_workers) as pool:
            futures = {
                pool.submit(
                    self._downloader,
                    url=url,
                    dest_path=dest_path,
                    chunk_size=chunk_size,
                    with_pbar=with_pbar,
                ): url
                for url, dest_path in url_to_dest.items()
            }

            for f in as_completed(futures):
                f.result()

    def download_files(
        self,
        urls: list[str],
        out_dir: Path,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ) -> None:
        """
        Download a bare list of URLs into out_dir.

        For e.g. per-sample supplementary files; same threaded fetch as the
        supplementary/run downloaders.
        """
        num_workers = _normalize_num_workers(num_workers)
        out_dir.mkdir(parents=True, exist_ok=True)

        url_to_dest: dict[str, Path] = {}
        for url in urls:
            normalized_url = _normalize_url(url)
            url_to_dest[normalized_url] = out_dir / Path(normalized_url.split("/")[-1])

        with ThreadPoolExecutor(num_workers) as pool:
            futures = {
                pool.submit(
                    self._downloader,
                    url=url,
                    dest_path=dest_path,
                    chunk_size=chunk_size,
                    with_pbar=with_pbar,
                ): url
                for url, dest_path in url_to_dest.items()
            }

            for f in as_completed(futures):
                f.result()

    def download_study_runs_data(
        self,
        runs: StudyRunsResults,
        out_dir: Path,
        mode: Literal["fastq", "sra", "sra_lite", "s3", "gcs"],
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = True,
    ) -> None:
        """
        Download the read files of every run into out_dir.

        Args:
            runs: The runs to fetch, from fetch_study_runs or Dataset.runs. Pass a
                filtered list to fetch a subset.
            out_dir: Created if it does not exist.
            mode: Which copy to take: fastq, sra, sra_lite, s3, or gcs. Not every
                run offers every mode.
            num_workers: Parallel downloads. Defaults to the core count less two.
            chunk_size: Bytes per read from the socket.
            with_pbar: Show a per-file progress bar.

        Raises:
            ValueError: If a run carries no URL for the requested mode.

        """
        _validate_study_runs_data(runs, mode)
        num_workers = _normalize_num_workers(num_workers)
        out_dir.mkdir(parents=True, exist_ok=True)

        url_to_dest: dict[str, Path] = {}

        for r in runs:
            run_urls, run_bytes, run_md5s = _extract_download_info_for_study_run(
                r, mode
            )

            if not run_urls or not run_bytes or not run_md5s:
                raise ValueError(
                    f"failed to extract download info for {r.run_accession}"
                )

            for _i, url in enumerate(run_urls):
                normalized_url = _normalize_url(url)
                dest_path = out_dir / Path(normalized_url.split("/")[-1])
                url_to_dest[normalized_url] = dest_path

        with ThreadPoolExecutor(num_workers) as pool:
            futures = {
                pool.submit(
                    self._downloader,
                    url=url,
                    dest_path=dest_path,
                    chunk_size=chunk_size,
                    with_pbar=with_pbar,
                ): url
                for url, dest_path in url_to_dest.items()
            }

            for f in as_completed(futures):
                f.result()

    def close(self) -> None:
        """Release client resources. The HTTP session is process-wide and stays open."""

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
