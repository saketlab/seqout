import functools
import itertools
from collections.abc import Callable, Iterator
from concurrent.futures import (
    Future,
    ThreadPoolExecutor,
    as_completed,
)
from pathlib import Path
from typing import Any, Literal, Self, TypeVar

import requests

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
    SearchResult,
    SearchResults,
    StructuredSearchParams,
    StudyExperimentsResults,
    StudyRunsResponse,
    StudyRunsResult,
    StudyRunsResults,
)
from seqout.utils import (
    _extract_download_info_for_study_run,
    _normalize_num_workers,
    _normalize_url,
    _validate_study_runs_data,
)

SearchParamsType = SearchParams | StructuredSearchParams
_NOT_FOUND = 404
T = TypeVar("T")


def _as_params(
    params: SearchParamsType | str | None, filters: dict[str, Any]
) -> SearchParamsType:
    """
    Let the search calls take a bare query string plus keyword filters.

    ``search("liver", organism="Homo sapiens")`` and the original
    ``search(SearchParams(...))`` both work.
    """
    if isinstance(params, str):
        return SearchParams(q=params, **filters)
    if params is None:
        return SearchParams(**filters)
    return params


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
        # `first` lets a caller that already fetched page 0 (e.g. to read its
        # spelling correction) reuse it instead of hitting the endpoint twice.
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

    def search_with_correction(
        self,
        params: SearchParamsType | str | None = None,
        **filters: Any,
    ) -> tuple[SearchCorrection | None, Iterator[SearchResult]]:
        """
        Return page 0's spelling correction plus the full result iterator.

        The correction (``did you mean`` / augmented extra matches) only rides on
        the first page; this reuses that page so paging costs no extra request.
        """
        params = _as_params(params, filters)
        first = self._fetch_search_page(params)
        return first.correction, self._iter_search_pages(params, first=first)

    def search(
        self,
        params: SearchParamsType | str | None = None,
        **filters: Any,
    ) -> SearchResults:
        """Full-text search. Takes a query string, or a params object."""
        response = self._fetch_search_page(_as_params(params, filters))

        return response.to_results()

    def iter_search(
        self,
        params: SearchParamsType | str | None = None,
        limit: int | None = None,
        **filters: Any,
    ) -> Iterator[SearchResult]:
        """Iterate every page of results, transparently following the cursor."""
        iterator = self._iter_search_pages(_as_params(params, filters))
        if limit is None:
            yield from iterator
        else:
            yield from itertools.islice(iterator, limit)

    def bulk_search(
        self,
        params: list[SearchParamsType],
        num_workers: int | None = None,
    ) -> dict[int, SearchResults]:
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
        return self._sender(
            url=f"{self._base_url}/project/{accession_id}/metadata",
            response_model=ProjectSummaryResult,
        )

    def bulk_fetch_project_summary(
        self, accession_ids: list[str]
    ) -> ProjectSummaryResultList:
        return self._poster(
            url=f"{self._base_url}/bulk/project-metadata",
            response_model=ProjectSummaryResultList,
            json={"accessions": accession_ids},
        )

    def fetch_project_metadata(self, accession_id: str) -> ProjectMetadataResult:
        return self._sender(
            url=f"{self._base_url}/project/{accession_id}",
            response_model=ProjectMetadataResult,
        )

    def fetch_samples(self, accession_id: str) -> ExperimentSampleList:
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
        response = self._sender(
            url=f"{self._base_url}/project/{accession_id}/xref",
            response_model=ProjectCrossReferenceResponse,
        )

        return response.xref

    def fetch_project_enriched_metadata(
        self, accession_id: str
    ) -> ProjectLLMEnrichedSampleMetadataResults:
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
        return self._sender(
            url=f"{self._base_url}/project/{study_id}/experiments",
            response_model=StudyExperimentsResults,
        )

    def fetch_study_runs(
        self, study_id: str, *, full: bool = False
    ) -> StudyRunsResults:
        # default returns the backend's 500-run preview; full=True gets every run
        # (needed for complete downloads and accession conversions).
        response = self._sender(
            url=f"{self._base_url}/project/{study_id}/runs",
            params={"full": "true"} if full else None,
            response_model=StudyRunsResponse,
        )

        return response.runs

    def classify_accession(self, accession_id: str) -> AccessionClassification:
        return self._sender(
            url=f"{self._base_url}/accession/{accession_id}/classify",
            response_model=AccessionClassification,
        )

    def fetch_run(self, run_id: str) -> StudyRunsResult:
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

    # resolvers share their names with SeqoutParquetClient so the CLI's
    # conversion and download helpers work against either backend

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
        anything    search — works when the accession is FTS-indexed
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
        """Last resort — works only when the accession is full-text indexed."""
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
        # /sample-detail serves every archive, but a GEO sample's `sample` block
        # is channel-shaped, so it needs the GEO model to validate.
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
        Return a series' linked sequencing study — the route to its runs.

        Cross-references answer for GEO and ArrayExpress. GEA (E-GEAD-N) files
        no cross-reference at all and names its data only as a BioProject in the
        project record, so that is tried next rather than giving up.
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
        # all datasets linked to an author across GEO/SRA/ArrayExpress/ENA.
        return self._sender(
            url=f"{self._base_url}/author/projects",
            params={"q": name, "limit": limit},
            response_model=AuthorProjectsResponse,
        )

    def find_publication(
        self, *, pmid: str | None = None, doi: str | None = None
    ) -> PublicationLookupResult:
        # reverse lookup: publication -> linked projects across all sources.
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
        return self._sender(
            url=f"{self._base_url}/sample/{sample_id}",
            response_model=SampleMetadataResult,
        )

    def fetch_sample_detailed_metadata(self, sample_id: str) -> SampleDetailedMetadata:
        return self._sender(
            url=f"{self._base_url}/sample-detail/{sample_id}",
            response_model=SampleDetailedMetadata,
        )

    def fetch_geo_sample_detailed_metadata(
        self, sample_id: str
    ) -> GeoSampleDetailedMetadata:
        return self._sender(
            url=f"{self._base_url}/sample-detail/{sample_id}",
            response_model=GeoSampleDetailedMetadata,
        )

    def download_project_supplementary_data(
        self,
        metadata: ProjectMetadataResult,
        out_dir: Path,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ) -> None:
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
        pass

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
