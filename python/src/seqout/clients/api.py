import contextlib
import datetime
import functools
import hashlib
import itertools
import logging
from collections import Counter
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import (
    Future,
    ThreadPoolExecutor,
    as_completed,
)
from pathlib import Path
from typing import Any, Literal, NoReturn, Self, TypeVar
from urllib.parse import quote

import pandas as pd
import requests

from seqout.cohort import PAGE as COHORT_PAGE
from seqout.cohort import SORTABLE, check_filters, check_names
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
from seqout.exception import SeqoutError
from seqout.helpers import (
    _download_file,
    _send_req,
)
from seqout.models.api_models import (
    AccessionClassification,
    AuthorProjectsResponse,
    BamFile,
    BamFiles,
    BamsResponse,
    ExperimentRunsResponse,
    ExperimentSampleList,
    GeoSampleDetailedMetadata,
    OntologyTerm,
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
    SearchTotal,
    StructuredSearchParams,
    StudyExperimentsResults,
    StudyRunsResponse,
    StudyRunsResult,
    StudyRunsResults,
    SupplementaryFilesResult,
)
from seqout.models.cohort_models import (
    Cohort,
    CohortResponse,
    CohortSample,
    Microbes,
    MicrobesResponse,
    SingleCellResponse,
    SingleCellSamples,
    SingleCellStudy,
)
from seqout.models.country_models import (
    CountryFacetValue,
    CountryProjects,
    CountryProjectsResponse,
    CountrySummary,
)
from seqout.models.disease_models import (
    DISEASE_CURATED_COLLECTIONS,
    DiseaseAliasResponse,
    DiseaseAliasResults,
    DiseaseFacetValue,
    DiseaseProjects,
    DiseaseProjectsResponse,
    DiseaseSummary,
    DiseaseTermProjects,
    DiseaseTermProjectsResponse,
    OntologyTermSummary,
)
from seqout.models.longread_models import (
    LongreadChemistryResponse,
    LongreadFacetValue,
    LongreadProjects,
    LongreadProjectsResponse,
    LongreadRun,
    LongreadSummary,
)
from seqout.models.models import Facets, FacetValue
from seqout.models.parquet_models import Study
from seqout.models.pentimento_models import (
    SingleCellCorpusStudies,
    SingleCellCorpusStudy,
    SingleCellStatus,
    SingleCellStatusResult,
    SingleCellStudiesResponse,
    SingleCellStudySummary,
    SingleCellStudySummaryResult,
)
from seqout.models.perturbation_models import (
    PerturbationFacetValue,
    PerturbationProjects,
    PerturbationProjectsResponse,
    PerturbationSummary,
)
from seqout.models.search_models import (
    AssayFiltersResponse,
    AssayValue,
    AssayValues,
    FilterValues,
    FilterValuesResponse,
    Organism,
    Organisms,
    OrganismsResponse,
    PlatformCounts,
    PlatformsResponse,
    SearchFacetCounts,
    SearchFacetsResponse,
    SearchFacetValue,
    SearchSuggestions,
    SearchSuggestResponse,
)
from seqout.models.singlecell_models import (
    SingleCellFacetValue,
    SingleCellProjects,
    SingleCellProjectsResponse,
    SingleCellSummary,
)
from seqout.models.spatial_models import (
    SpatialFacetValue,
    SpatialProjects,
    SpatialProjectsResponse,
    SpatialSummary,
)
from seqout.models.tissue_models import (
    TissueFacetValue,
    TissueProjects,
    TissueProjectsResponse,
)
from seqout.search_plan import SearchPlan, apply_plan, plan_search
from seqout.utils import (
    StudyRunDownloadMode,
    _normalize_num_workers,
    _normalize_url,
    _run_files_to_fetch,
    _url_destinations,
)

logger = logging.getLogger(__name__)

_NOT_FOUND = 404

# /project/{acc}/single-cell caps a page at 1000 rows.
PENTIMENTO_PAGE = 1000

# every collection's /projects endpoint caps a page at 200 rows
COLLECTION_PAGE = 200

SearchParamsType = SearchParams | StructuredSearchParams
T = TypeVar("T")

# refuse rather than clamp; a clamped result would look complete
FILTER_LIMIT_MAX = 5000

# /single-cell/studies caps a page at 1000 rows.
SINGLE_CELL_STUDIES_PAGE = 1000

# None leaves filtering to require_matrix
_SINGLE_CELL_KINDS: dict[str, frozenset[str] | None] = {
    "any": None,
    "matrix": None,
    "both": frozenset({"matrix_and_reads", "matrix_reads_unscanned"}),
    "fastq": frozenset({"matrix_and_reads", "matrix_reads_unscanned", "reads_only"}),
}


def _parquet_only(method: str, reason: str) -> NoReturn:
    """Raise because method reads the Parquet dump."""
    msg = (
        f"{method} reads the Parquet dump; this client is REST. {reason} "
        f"Open a Parquet client for it: connect('parquet')."
    )
    raise SeqoutError(msg)


def _term_segment(term: str) -> str:
    """Percent-encode a free-text ontology term for a path segment."""
    # terms routinely carry spaces and punctuation ("fatty liver disease")
    return quote(term.strip(), safe="")


def _disease_segment(collection: str) -> tuple[str, bool]:
    """Return the path segment for a disease collection, and if it is curated."""
    canon = collection.strip().lower()
    if canon in DISEASE_CURATED_COLLECTIONS:
        return canon, True
    return _term_segment(collection), False


def _check_limit(limit: int) -> int:
    """Refuse a limit past the server's ceiling before it answers 422."""
    most = FILTER_LIMIT_MAX
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= most:
        msg = f"limit must be one whole number between 1 and {most}, not {limit!r}."
        raise ValueError(msg)
    return limit


def _md5_matches(path: Path, want: str) -> bool:
    seen = hashlib.md5()  # noqa: S324
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


def _ontology_ids(
    term: OntologyTerm | None, ontology: str | None, *, use_synonyms: bool
) -> str | None:
    """Take the CURIEs for one label: its own, or its synonyms' when it has none."""
    if term is None:
        return None
    xrefs = list(term.xrefs)
    if not xrefs and use_synonyms:
        xrefs = [x for s in term.synonyms for x in s.xrefs]
    if ontology:
        # CVCL_0030 has no colon, so the prefix ends at whichever comes first.
        xrefs = [x for x in xrefs if x.split(":")[0].split("_")[0] == ontology]
    return ",".join(dict.fromkeys(xrefs)) or None


def _as_plan(
    params: SearchParamsType | str | None, filters: dict[str, Any]
) -> SearchPlan:
    """
    Build a SearchPlan from a query or params object plus keyword filters.

    Bare strings use plan_search. Hand-built params are sent as provided.
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

    # /search/facets counts the same match set, and its q is required, so a
    # filter-only search has no cheap total. Everything else it takes is a
    # subset of SearchParams.
    _COUNTABLE = frozenset(
        {
            "q",
            "db",
            "structured",
            "exclude_ontology",
            "case_sensitive",
            "organism",
            "country",
            "library_strategy",
            "library_source",
            "instrument_model",
            "platform",
            "journal",
            "multi_platform",
            "long_read",
            "date_from",
            "date_to",
        }
    )

    # /search/facets bounds by year_*, not date_*; long_read times it out
    FACET_FILTERS = (
        _COUNTABLE
        - {"q", "structured", "exclude_ontology", "long_read", "date_from", "date_to"}
    ) | {"year_from", "year_to"}

    def _search_total(self, params: SearchParamsType) -> int | None:
        """Count matches exactly when /search/facets can answer cheaply."""
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
            return None  # Continue the search if counting fails.

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

    def _walk_pages(
        self,
        url: str,
        params: dict[str, Any],
        response_model: type[Any],
        *,
        limit: int | None,
        offset: int = 0,
        keyset: bool = False,
        keep: Callable[[Any], bool] | None = None,
    ) -> tuple[list[Any], int]:
        """Walk a `/projects` endpoint by offset or `next_cursor` to `limit` rows."""
        rows: list[Any] = []
        total = 0
        at: dict[str, Any] = (
            {"cursor_sort": None, "cursor_acc": None} if keyset else {"offset": offset}
        )
        # results arrive in sort order, so later pages can't outrank kept rows
        while limit is None or len(rows) < limit:
            # a local filter makes the kept count unknown, so read whole pages
            want = COLLECTION_PAGE
            if limit is not None and keep is None:
                want = min(limit - len(rows), COLLECTION_PAGE)
            page = self._sender(
                url=url,
                params={**params, **at, "limit": want},
                response_model=response_model,
            )
            total = page.total
            rows.extend(page.results if keep is None else filter(keep, page.results))
            if keyset:
                # an empty page ends the walk even if a cursor came back
                if page.next_cursor is None or not page.results:
                    break
                at = {
                    "cursor_sort": page.next_cursor.sort_value,
                    "cursor_acc": page.next_cursor.accession,
                }
                continue
            at = {"offset": at["offset"] + page.count}
            # a stale total would otherwise page forever
            if page.count == 0 or at["offset"] >= page.total:
                break
        return rows if limit is None else rows[:limit], total

    def _search_with_correction(
        self,
        params: SearchParamsType | str | None = None,
        **filters: Any,
    ) -> tuple[SearchCorrection | None, int | None, Iterator[SearchResult]]:
        """Return page-0 correction, total, and a lazy result iterator."""
        plan = _as_plan(params, filters)
        # page and count run together; latency is max(page, count)
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
        Search projects and follow cursors past the first page.

        Pass `limit` to stop early. `expand=False` uses exact terms, and
        `exclude_ontology` removes named ontology sources from expansion.
        `case_sensitive=True` keeps only matches whose title or summary has the
        query words in the exact case, so "LINE" drops "cell line".
        """
        plan = _as_plan(params, filters)
        rows: Iterable[SearchResult] = self._iter_search_pages(plan.params)
        if plan.has_local_work:
            # A row dropped or reordered here has to move before limit counts.
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

    def fetch_supplementary_files(self, accession_id: str) -> SupplementaryFilesResult:
        """
        List a GEO/ArrayExpress/GEA project's supplementary files.

        Each file carries `gene_corruption`, its scan for Excel's
        gene-symbol-to-date autocorrupt bug; `None` means unscanned, not clean.
        """
        return self._sender(
            url=f"{self._base_url}/project/{accession_id}/supplementary",
            response_model=SupplementaryFilesResult,
        )

    def fetch_samples(self, accession_id: str) -> ExperimentSampleList:
        """
        Fetch GEO or ArrayExpress sample records.

        Raises:
            ValueError: If the accession names another source.

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
        """Fetch prepared per-sample labels. Missing coverage returns empty."""
        response = self._get_or_none(
            f"{self._base_url}/project/{accession_id}/enriched",
            ProjectLLMEnrichedSampleMetadataResponse,
        )
        if response is None:
            return ProjectLLMEnrichedSampleMetadataResults([])
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
            full: Read every run. The default is the backend's 500-run preview.
                Downloads require the full list.

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
        """Run a lookup whose misses return None here."""
        try:
            return fn()
        except Exception:
            return None

    def resolve_study(self, accession: str) -> str | None:
        """
        Resolve a child accession to its study root.

        Exact routes: run via /run, GSA experiment via sample detail,
        SRA/DDBJ experiment via first run, and sample via sample detail. Search
        is the fallback.
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
            # GSA answers on sample-detail; SRA/DDBJ uses an experiment run
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
        """Return a linked sequencing study, falling back to GEA BioProject."""
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
        res = self._get_or_none(
            f"{self._base_url}/publication", PublicationLookupResult, params
        )
        return PublicationLookupResult() if res is None else res

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
                url=url,
                dest_path=dest_path,
                chunk_size=chunk_size,
                with_pbar=with_pbar,
            )
            want = (md5s or {}).get(url)
            if want and not _md5_matches(dest_path, want):
                # Remove corrupt alignments to prevent reuse.
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

    def sample_search(
        self,
        *,
        include_descendants: bool = True,
        sort: str = "sample",
        order: str = "asc",
        limit: int | None = None,
        **filters: Any,
    ) -> Cohort:
        """
        Search harmonised samples across studies.

        Filters hit normalized tissue, disease, cell type, assay, age, and
        ontology IDs. At least one filter is required; an unfiltered search
        would return every harmonised sample. `Cohort.total` counts matches
        before `limit`; `Cohort.filters` reports server-applied filters.
        """
        filters = {k: v for k, v in filters.items() if v is not None}
        if not filters:
            msg = (
                "give at least one filter: an unfiltered search would return "
                "every harmonised sample."
            )
            raise ValueError(msg)
        check_filters(filters)
        if sort not in SORTABLE:
            msg = f"sort must be one of {', '.join(SORTABLE)}"
            raise ValueError(msg)
        if order not in ("asc", "desc"):
            msg = "order must be 'asc' or 'desc'"
            raise ValueError(msg)
        if limit is not None:
            limit = max(1, int(limit))

        rows: list[CohortSample] = []
        offset = 0
        page: CohortResponse | None = None
        while True:
            want = COHORT_PAGE if limit is None else min(COHORT_PAGE, limit - len(rows))
            page = self._sender(
                url=f"{self._base_url}/samples/search",
                params={
                    **filters,
                    "include_descendants": include_descendants,
                    "sort": sort,
                    "order": order,
                    "limit": want,
                    "offset": offset,
                },
                response_model=CohortResponse,
            )
            rows.extend(page.samples)
            # A stale next_offset would page forever.
            if not page.samples or page.next_offset is None:
                break
            if limit is not None and len(rows) >= limit:
                break
            offset = page.next_offset

        if limit is not None:
            rows = rows[:limit]  # defend against a server that overshoots
        return Cohort(
            rows,
            total=page.total if page else len(rows),
            filters=page.filters if page else {},
        )

    def fetch_single_cell(
        self,
        accession: str,
        limit: int | None = None,
        offset: int = 0,
    ) -> SingleCellSamples:
        """
        Per-sample matrix dimensions and read-derived calls for a study.

        `cells` counts matrix columns; unfiltered 10x matrices count barcodes,
        so sums overcount. `has_*_reads` is None when unscreened and False when
        screened with no gated hit. Missing Pentimento records return empty.
        """
        path = f"{self._base_url}/project/{accession.strip().upper()}/single-cell"

        def page(want: int, at: int) -> SingleCellResponse | None:
            return self._get_or_none(
                path, SingleCellResponse, {"limit": want, "offset": at}
            )

        want = PENTIMENTO_PAGE if limit is None else min(limit, PENTIMENTO_PAGE)
        first = page(want, offset)
        if first is None:
            return SingleCellSamples([])

        rows = list(first.samples)
        total = first.n_samples_detailed
        if total is not None:
            wanted = total - offset if limit is None else min(limit, total - offset)
            while len(rows) < wanted:
                more = page(
                    min(PENTIMENTO_PAGE, wanted - len(rows)), offset + len(rows)
                )
                # A stale total would page forever.
                if more is None or not more.samples:
                    break
                rows.extend(more.samples)

        return SingleCellSamples(
            rows,
            # longread_chemistry is None past the first page; only offset 0 computes it
            study=SingleCellStudy.model_validate(first.model_dump()),
            n_samples_total=total,
        )

    def fetch_microbes(
        self,
        accession: str,
        kind: Literal["all", "viral", "bacterial", "both"] = "all",
        *,
        min_breadth: float | None = None,
        min_kmer_mass: float | None = None,
        validated_only: bool = False,
        include_background: bool = False,
        limit: int = 500,
    ) -> Microbes:
        """
        Microbial sequence found in a sample's reads, by organism.

        Spike-in and negative controls stay out of totals. Reagent and skin
        organisms require `include_background`. Detections include gated and
        ungated organisms. Empty with `measurable` False means unscreened.
        """
        res = self._sender(
            url=f"{self._base_url}/sample/{accession.strip().upper()}/microbes",
            params={
                "kind": kind,
                "min_breadth": min_breadth,
                "min_kmer_mass": min_kmer_mass,
                "validated_only": validated_only,
                "include_background": include_background,
                "limit": limit,
            },
            response_model=MicrobesResponse,
        )
        if not res.measurable:
            logger.warning(
                "%s was never screened for microbes. The empty result reports "
                "missing data and rules nothing out; see Microbes.measurable.",
                accession,
            )
        return Microbes(
            res.by_organism,
            detections=res.detections,
            measurable=res.measurable,
            n_runs=res.n_runs,
            totals=res.totals,
            by_kingdom=res.by_kingdom,
            control_kingdoms=res.control_kingdoms,
        )

    def fetch_longread_summary(self) -> LongreadSummary:
        """Corpus-wide totals for studies with a PacBio or Oxford Nanopore run."""
        return self._sender(
            url=f"{self._base_url}/longread/summary",
            response_model=LongreadSummary,
        )

    def fetch_longread_facets(self) -> dict[str, list[LongreadFacetValue]]:
        """
        Long-read facet study counts.

        Per technology, platform, instrument, organism, archive, chemistry and year.
        """
        return self._facets("/longread/facets")

    def fetch_longread_projects(
        self,
        *,
        technology: str | None = None,
        platform: str | None = None,
        instrument_model: str | None = None,
        library_strategy: str | None = None,
        organism: str | None = None,
        archive: str | None = None,
        chemistry: str | None = None,
        assay_l1: str | None = None,
        year: int | None = None,
        has_fastq: bool | None = None,
        has_sra: bool | None = None,
        long_read_only: bool | None = None,
        has_exact_chemistry: bool | None = None,
        single_cell: bool | None = None,
        sort: str = "n_experiments",
        order: str = "desc",
        limit: int | None = None,
        offset: int = 0,
    ) -> LongreadProjects:
        """
        Studies with a PacBio or Oxford Nanopore experiment, any archive.

        A study mirrored in more than one archive counts once. `long_read_only`
        filters to studies with no other platform (None rows have no experiment
        rows to judge by). `single_cell` keeps only studies also flagged
        single-cell (`is_single_cell`); the server has no such parameter, so
        this filters locally.
        """
        params = {
            "technology": technology,
            "platform": platform,
            "instrument_model": instrument_model,
            "library_strategy": library_strategy,
            "organism": organism,
            "archive": archive,
            "chemistry": chemistry,
            "assay_l1": assay_l1,
            "year": year,
            "has_fastq": has_fastq,
            "has_sra": has_sra,
            "long_read_only": long_read_only,
            "has_exact_chemistry": has_exact_chemistry,
            "sort": sort,
            "order": order,
        }
        keep = None
        if single_cell is not None:
            keep = lambda r: r.is_single_cell is single_cell  # noqa: E731
        rows, total = self._walk_pages(
            f"{self._base_url}/longread/projects",
            params,
            LongreadProjectsResponse,
            limit=limit,
            offset=offset,
            keep=keep,
        )
        return LongreadProjects(rows, total=total)

    def fetch_longread_chemistry(self, accession: str) -> list[LongreadRun]:
        """
        Every PacBio/Oxford Nanopore run for a study.

        Independent of single-cell status. `[]` means no long-read runs.
        """
        return self._sender(
            url=f"{self._base_url}/project/{accession.strip().upper()}/longread-chemistry",
            response_model=LongreadChemistryResponse,
        ).runs

    def fetch_country_summary(self, code: str) -> CountrySummary:
        """
        Corpus-wide totals for studies submitted from one country.

        `code` is an ISO-3166-1 alpha-2 code (e.g. "US", "IN"), case-folded to
        upper. A malformed code raises `requests.HTTPError` with a 404; a
        well-formed code the server has no stats for raises one with a 503.
        """
        return self._sender(
            url=f"{self._base_url}/country/{code.strip().upper()}/summary",
            response_model=CountrySummary,
        )

    def fetch_country_facets(self, code: str) -> dict[str, list[CountryFacetValue]]:
        """Study counts per organism, assay, archive, year and single-cell status."""
        return self._facets(f"/country/{code.strip().upper()}/facets")

    def fetch_country_projects(
        self,
        code: str,
        *,
        organism: str | None = None,
        assay_l1: str | None = None,
        source: str | None = None,
        has_fastq: bool | None = None,
        has_sra: bool | None = None,
        is_single_cell: bool | None = None,
        q: str | None = None,
        sort: str = "year",
        order: str = "desc",
        limit: int | None = None,
        offset: int = 0,
    ) -> CountryProjects:
        """
        Studies submitted from one country.

        Filter values come from `fetch_country_facets`. `q` matches title or
        study_accession (case-insensitive substring). `limit=None` (the
        default) walks every page; pass a `limit` for a large country such
        as "US".
        """
        params = {
            "organism": organism,
            "assay_l1": assay_l1,
            "source": source,
            "has_fastq": has_fastq,
            "has_sra": has_sra,
            "is_single_cell": is_single_cell,
            "q": q,
            "sort": sort,
            "order": order,
        }
        rows, total = self._walk_pages(
            url=f"{self._base_url}/country/{code.strip().upper()}/projects",
            params=params,
            response_model=CountryProjectsResponse,
            limit=limit,
            offset=offset,
        )
        return CountryProjects(rows, total=total)

    def fetch_singlecell_summary(self) -> SingleCellSummary:
        """
        Corpus-wide totals for studies with single-cell evidence.

        Matrix or read-derived evidence, or a declared single-cell
        classification; the population `fetch_singlecell_projects` lists.
        `cells` excludes studies whose only matrix is unfiltered (raw 10x
        barcodes, not real cells).
        """
        return self._sender(
            url=f"{self._base_url}/single-cell/summary",
            response_model=SingleCellSummary,
        )

    def fetch_singlecell_facets(self) -> dict[str, list[SingleCellFacetValue]]:
        """Study counts per chemistry, organism, tissue, modality and assay."""
        return self._facets("/single-cell/facets")

    def fetch_singlecell_projects(
        self,
        *,
        chemistry: str | None = None,
        organism: str | None = None,
        tissue: str | None = None,
        cell_or_nucleus: str | None = None,
        perturbation_method: str | None = None,
        intervention_kind: str | None = None,
        modality: str | None = None,
        assay_l1: str | None = None,
        year: int | None = None,
        has_matrix: bool | None = None,
        has_fastq: bool | None = None,
        has_sra: bool | None = None,
        is_long_read: bool | None = None,
        q: str | None = None,
        sort: str = "year",
        order: str = "desc",
        limit: int | None = None,
        offset: int = 0,
    ) -> SingleCellProjects:
        """
        Studies with matrix or read-derived single-cell evidence, corpus-wide.

        Filter values come from `fetch_singlecell_facets`; `year` is the
        publication year. `q` matches title or study_accession
        (case-insensitive substring). `limit=None` (the default) walks every
        page.
        """
        params = {
            "chemistry": chemistry,
            "organism": organism,
            "tissue": tissue,
            "cell_or_nucleus": cell_or_nucleus,
            "perturbation_method": perturbation_method,
            "intervention_kind": intervention_kind,
            "modality": modality,
            "assay_l1": assay_l1,
            "year": year,
            "has_matrix": has_matrix,
            "has_fastq": has_fastq,
            "has_sra": has_sra,
            "is_long_read": is_long_read,
            "q": q,
            "sort": sort,
            "order": order,
        }
        rows, total = self._walk_pages(
            url=f"{self._base_url}/single-cell/projects",
            params=params,
            response_model=SingleCellProjectsResponse,
            limit=limit,
            offset=offset,
        )
        return SingleCellProjects(rows, total=total)

    def fetch_perturbation_summary(self) -> PerturbationSummary:
        """Corpus-wide totals for single-cell studies with perturbation evidence."""
        return self._sender(
            url=f"{self._base_url}/perturbation/summary",
            response_model=PerturbationSummary,
        )

    def fetch_perturbation_facets(self) -> dict[str, list[PerturbationFacetValue]]:
        """
        Perturbation facet study counts.

        Per perturbation type, confidence, data availability, genetic
        subtype, perturbation method, compound, organism, tissue, readout
        assay, cell line, sample type and year.
        """
        return self._facets("/perturbation/facets")

    def fetch_perturbation_projects(
        self,
        *,
        perturbation_type: str | None = None,
        confidence: str | None = None,
        min_confidence: str | None = None,
        data_availability: str | None = None,
        genetic_subtype: str | None = None,
        perturbation_method: str | None = None,
        compound: str | None = None,
        readout_assay: str | None = None,
        cell_line: str | None = None,
        organism: str | None = None,
        tissue: str | None = None,
        year: int | None = None,
        has_matrix: bool | None = None,
        has_fastq: bool | None = None,
        has_control_arm: bool | None = None,
        is_pooled: bool | None = None,
        is_long_read: bool | None = None,
        q: str | None = None,
        sort: str = "confidence",
        order: str = "desc",
        limit: int | None = None,
        offset: int = 0,
    ) -> PerturbationProjects:
        """
        Single-cell studies with genetic or chemical perturbation evidence.

        Detection is rule-based; `confidence` is `"high"`, `"medium"` or
        `"low"`. Use `min_confidence="medium"` for studies to rely on;
        `confidence` matches one tier exactly. Filter values come from
        `fetch_perturbation_facets`. `limit=None` (the default) walks every
        page.
        """
        params = {
            "perturbation_type": perturbation_type,
            "confidence": confidence,
            "min_confidence": min_confidence,
            "data_availability": data_availability,
            "genetic_subtype": genetic_subtype,
            "perturbation_method": perturbation_method,
            "compound": compound,
            "readout_assay": readout_assay,
            "cell_line": cell_line,
            "organism": organism,
            "tissue": tissue,
            "year": year,
            "has_matrix": has_matrix,
            "has_fastq": has_fastq,
            "has_control_arm": has_control_arm,
            "is_pooled": is_pooled,
            "is_long_read": is_long_read,
            "q": q,
            "sort": sort,
            "order": order,
        }
        rows, total = self._walk_pages(
            url=f"{self._base_url}/perturbation/projects",
            params=params,
            response_model=PerturbationProjectsResponse,
            limit=limit,
            offset=offset,
        )
        return PerturbationProjects(rows, total=total)

    def fetch_spatial_summary(self) -> SpatialSummary:
        """Corpus-wide totals for studies flagged spatial transcriptomics."""
        return self._sender(
            url=f"{self._base_url}/spatial/summary",
            response_model=SpatialSummary,
        )

    def fetch_spatial_facets(self) -> dict[str, list[SpatialFacetValue]]:
        """
        Spatial transcriptomics facet study counts.

        Per platform, resolution, data availability, organism, tissue,
        readout assay, cell line, sample type and year.
        """
        return self._facets("/spatial/facets")

    def fetch_spatial_projects(
        self,
        *,
        platform: str | None = None,
        resolution: str | None = None,
        technology: str | None = None,
        data_availability: str | None = None,
        organism: str | None = None,
        tissue: str | None = None,
        readout_assay: str | None = None,
        cell_line: str | None = None,
        sample_type: str | None = None,
        year: int | None = None,
        has_matrix: bool | None = None,
        has_fastq: bool | None = None,
        is_long_read: bool | None = None,
        q: str | None = None,
        sort: str = "year",
        order: str = "desc",
        limit: int | None = None,
        offset: int = 0,
    ) -> SpatialProjects:
        """
        Studies flagged single-cell modality "Spatial Transcriptomics".

        `platform` filters on a name from `fetch_spatial_facets` (Visium,
        Xenium, MERFISH, ...). A row's platform is often null, and a named one
        is a text mention, not proof the study ran it. `resolution` is
        "single-cell", "spot" or "roi" (GeoMx DSP). `technology` is "imaging",
        "sequencing" or "hybrid" (GeoMx DSP); a separate column from
        `resolution`, though the two match one-to-one today. `limit=None`
        (the default) walks every page.
        """
        params = {
            "platform": platform,
            "resolution": resolution,
            "technology": technology,
            "data_availability": data_availability,
            "organism": organism,
            "tissue": tissue,
            "readout_assay": readout_assay,
            "cell_line": cell_line,
            "sample_type": sample_type,
            "year": year,
            "has_matrix": has_matrix,
            "has_fastq": has_fastq,
            "is_long_read": is_long_read,
            "q": q,
            "sort": sort,
            "order": order,
        }
        rows, total = self._walk_pages(
            url=f"{self._base_url}/spatial/projects",
            params=params,
            response_model=SpatialProjectsResponse,
            limit=limit,
            offset=offset,
        )
        return SpatialProjects(rows, total=total)

    def fetch_disease_summary(
        self, collection: str
    ) -> DiseaseSummary | OntologyTermSummary:
        """
        Corpus-wide totals for a disease collection or a free-text MONDO term.

        `collection` is `"rare"` (NIH GARD, matched by exact MONDO xref) or
        `"nord"` (NORD, matched by name): both return `DiseaseSummary`. Any
        other string is resolved as free text against the full MONDO
        ontology and returns `OntologyTermSummary`. The model is picked from
        `collection` (`DISEASE_CURATED_COLLECTIONS`), never from the response.
        An unresolvable term raises `requests.HTTPError` with a 404.
        """
        seg, is_curated = _disease_segment(collection)
        model = DiseaseSummary if is_curated else OntologyTermSummary
        return self._sender(
            url=f"{self._base_url}/disease/{seg}/summary",
            response_model=model,
        )

    def fetch_disease_facets(
        self, collection: str
    ) -> dict[str, list[DiseaseFacetValue]]:
        """
        Study counts per facet for a disease collection or free-text term.

        Both modes return the same `{value, studies}` facet shape.
        """
        return self._facets(f"/disease/{_disease_segment(collection)[0]}/facets")

    def fetch_disease_projects(
        self,
        collection: str,
        *,
        category: str | None = None,
        specialty: str | None = None,
        group: str | None = None,
        nord_type: str | None = None,
        ancestry: str | None = None,
        inheritance: str | None = None,
        disease: str | None = None,
        assay_category: str | None = None,
        organism: str | None = None,
        assay_l1: str | None = None,
        source: str | None = None,
        is_single_cell: bool | None = None,
        is_long_read: bool | None = None,
        has_fastq: bool | None = None,
        has_sra: bool | None = None,
        q: str | None = None,
        scope: str = "human_primary",
        sort: str | None = None,
        order: str = "desc",
        limit: int | None = None,
        offset: int = 0,
    ) -> DiseaseProjects | DiseaseTermProjects:
        """
        Studies with a sample in a disease collection, or matching a MONDO term.

        `category`/`specialty`/`group`/`nord_type`/`ancestry`/`inheritance`/
        `disease`/`assay_category` apply only to a curated `collection`
        (`"rare"` or `"nord"`) and `assay_l1`/`source`/`is_single_cell`/
        `is_long_read` only to a free-text term; passing one that does not
        apply to `collection` is rejected server-side with a 400 naming what
        does apply. `scope` (`"human_primary"`, `"patient_derived_model"`,
        `"cell_line"`, `"all"`) applies only to a curated collection.
        `sort=None` (the default) uses the server's default for each mode
        ("cells" curated, "pub_date" term). `limit=None` walks every page.

        A curated collection pages by `offset`. A free-text term pages by
        keyset: each page's `next_cursor` becomes the next request's
        `cursor_sort`/`cursor_acc`, and a nonzero `offset` raises `ValueError`.
        """
        seg, is_curated = _disease_segment(collection)
        if not is_curated and offset:
            msg = (
                "offset does not apply to a free-text disease term, which pages "
                "by cursor; use limit to cap the rows."
            )
            raise ValueError(msg)
        params = {
            "category": category,
            "specialty": specialty,
            "group": group,
            "nord_type": nord_type,
            "ancestry": ancestry,
            "inheritance": inheritance,
            "disease": disease,
            "assay_category": assay_category,
            "organism": organism,
            "assay_l1": assay_l1,
            "source": source,
            "is_single_cell": is_single_cell,
            "is_long_read": is_long_read,
            "has_fastq": has_fastq,
            "has_sra": has_sra,
            "q": q,
            "scope": scope,
            "sort": sort,
            "order": order,
        }
        rows, total = self._walk_pages(
            url=f"{self._base_url}/disease/{seg}/projects",
            params=params,
            response_model=DiseaseProjectsResponse
            if is_curated
            else DiseaseTermProjectsResponse,
            limit=limit,
            offset=offset,
            keyset=not is_curated,
        )
        result = DiseaseProjects if is_curated else DiseaseTermProjects
        return result(rows, total=total)

    def fetch_disease_aliases(self, q: str, limit: int = 20) -> DiseaseAliasResults:
        """Resolve a GARD or NORD disease name to its MONDO ids."""
        page = self._sender(
            url=f"{self._base_url}/disease/aliases",
            params={"q": q, "limit": limit},
            response_model=DiseaseAliasResponse,
        )
        return DiseaseAliasResults(
            page.results, total=page.total, truncated=page.truncated
        )

    def fetch_tissue_summary(self, term: str) -> OntologyTermSummary:
        """
        Corpus-wide totals for a free-text UBERON tissue term.

        `term` is always resolved against UBERON. An unresolvable term raises
        `requests.HTTPError` with a 404.
        """
        return self._sender(
            url=f"{self._base_url}/tissue/{_term_segment(term)}/summary",
            response_model=OntologyTermSummary,
        )

    def fetch_tissue_facets(self, term: str) -> dict[str, list[TissueFacetValue]]:
        """Study counts per organism, assay, source, journal, country and year."""
        return self._facets(f"/tissue/{_term_segment(term)}/facets")

    def fetch_tissue_projects(
        self,
        term: str,
        *,
        organism: str | None = None,
        assay_l1: str | None = None,
        source: str | None = None,
        has_fastq: bool | None = None,
        has_sra: bool | None = None,
        is_single_cell: bool | None = None,
        is_long_read: bool | None = None,
        q: str | None = None,
        sort: str = "pub_date",
        order: str = "desc",
        limit: int | None = None,
    ) -> TissueProjects:
        """
        Studies with a sample in a tissue matching `term`.

        Filter values come from `fetch_tissue_facets`. `q` matches title or
        study_accession (case-insensitive substring). `limit=None` walks
        every page.

        Pages by keyset: each page's `next_cursor` becomes the next request's
        `cursor_sort`/`cursor_acc`, as in `/search` `sortby` pagination. There
        is no `offset` parameter.
        """
        params = {
            "organism": organism,
            "assay_l1": assay_l1,
            "source": source,
            "has_fastq": has_fastq,
            "has_sra": has_sra,
            "is_single_cell": is_single_cell,
            "is_long_read": is_long_read,
            "q": q,
            "sort": sort,
            "order": order,
        }
        rows, total = self._walk_pages(
            url=f"{self._base_url}/tissue/{_term_segment(term)}/projects",
            params=params,
            response_model=TissueProjectsResponse,
            limit=limit,
            keyset=True,
        )
        return TissueProjects(rows, total=total)

    def _facets(self, path: str) -> dict[str, list[FacetValue]]:
        """GET a collection's `/facets`; every collection shares one shape."""
        return self._sender(url=f"{self._base_url}{path}", response_model=Facets).root

    def _get_or_none(
        self, url: str, response_model: type[T], params: dict | None = None
    ) -> T | None:
        """GET url; None when the server answers 404."""
        try:
            return self._sender(url=url, params=params, response_model=response_model)
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == _NOT_FOUND:
                return None
            raise

    def fetch_search_suggest(self, query: str) -> SearchSuggestions:
        """Suggest spelling corrections for a query; empty when it needs none."""
        q = SearchParams(q=query).q
        res = self._sender(
            url=f"{self._base_url}/search/suggest",
            params={"q": q},
            response_model=SearchSuggestResponse,
        )
        return SearchSuggestions(res.suggestions)

    def fetch_search_facets(
        self,
        query: str,
        *,
        structured: bool = False,
        exclude_ontology: list[str] | None = None,
        **filters: Any,
    ) -> SearchFacetCounts:
        """
        Count a search's full match set by facet.

        Values order by `score`, the summed match rank; it is 0 without a
        query. Filters narrow the set counted: see `FACET_FILTERS`.

        Returns:
            One row per facet value, with `total` and `max_rank` attributes.

        """
        check_names(filters, self.FACET_FILTERS, "facet filter", "sq.FACET_FILTERS")
        checked = SearchParams(q=query, exclude_ontology=exclude_ontology)
        params: dict[str, Any] = {
            "q": checked.q,
            **{k: v for k, v in filters.items() if v is not None},
        }
        if structured:
            params["structured"] = "true"
        if checked.exclude_ontology:
            params["exclude_ontology"] = list(dict.fromkeys(checked.exclude_ontology))
        res = self._sender(
            url=f"{self._base_url}/search/facets",
            params=params,
            response_model=SearchFacetsResponse,
        )
        rows = [
            SearchFacetValue.model_construct(facet=facet, **dict(b))
            for facet, buckets in res.facets.items()
            for b in buckets
        ]
        return SearchFacetCounts(rows, total=res.total, max_rank=res.max_rank)

    def _filter_values(self, path: str, **params: Any) -> FilterValues:
        res = self._sender(
            url=f"{self._base_url}{path}",
            params=params or None,
            response_model=FilterValuesResponse,
        )
        return FilterValues(res.values, total=res.total)

    def fetch_library_strategies(self) -> FilterValues:
        """Values `library_strategy` accepts, with record counts."""
        return self._filter_values("/filters/library-strategies")

    def fetch_instrument_models(self) -> FilterValues:
        """Values `instrument_model` accepts, with record counts."""
        return self._filter_values("/filters/instrument-models")

    def fetch_journals(self, limit: int = 500) -> FilterValues:
        """Values `journal` accepts, most records first; `limit` is 1 to 5000."""
        return self._filter_values("/filters/journals", limit=_check_limit(limit))

    def fetch_centers(self, limit: int = 500) -> FilterValues:
        """List submitting centers, most records first; `limit` is 1 to 5000."""
        return self._filter_values("/filters/centers", limit=_check_limit(limit))

    def fetch_organisms(self, *, common_names: bool = False) -> Organisms:
        """Every organism recorded across archives; optionally its common name."""
        res = self._sender(
            url=f"{self._base_url}/organisms",
            params={"common_names": "true" if common_names else "false"},
            response_model=OrganismsResponse,
        )
        rows = [
            o if isinstance(o, Organism) else Organism(scientific_name=o)
            for o in res.organisms
        ]
        return Organisms(rows, common_names=common_names)

    def fetch_assays(self, country: str | None = None) -> AssayValues:
        """
        Assay values at both levels, with study counts.

        `level` is `assay_l1` or `assay_l2`. `country` scopes the counts to
        one country, by name; None counts over every archive.
        """
        res = self._sender(
            url=f"{self._base_url}/stats/global-contribution-filters",
            params={"country": country},
            response_model=AssayFiltersResponse,
        )
        return AssayValues(
            [
                AssayValue(level=level, value=v.value, count=v.count)
                for level, values in (
                    ("assay_l1", res.assay_l1),
                    ("assay_l2", res.assay_l2),
                )
                for v in values
            ]
        )

    def fetch_platforms(self) -> PlatformCounts:
        """Sequencing platforms, with record counts per archive."""
        res = self._sender(
            url=f"{self._base_url}/platforms",
            response_model=PlatformsResponse,
        )
        return PlatformCounts(res.platforms)

    def fetch_single_cell_studies(
        self,
        min_evidence: int = 1,
        data: Literal["any", "matrix", "fastq", "both"] = "any",
        limit: int | None = None,
        offset: int = 0,
    ) -> SingleCellCorpusStudies:
        """
        Studies with single-cell evidence, one row each.

        `data` selects on `kind`: "matrix" keeps studies with a parsed counts
        matrix (filtered server-side), "fastq" those with linked reads, "both"
        those with both, "any" everything. Filters other than "matrix" run
        locally, so they read every page before `limit` counts. "any" warns
        when reads-only studies, which cannot feed a counts pipeline, came back.

        Args:
            min_evidence: Minimum independent measurements, 1 to 3.
            data: What the study must carry.
            limit: Maximum studies; None reads all, in pages of up to 1000.
            offset: Number of studies to skip, before local filtering.

        """
        if data not in _SINGLE_CELL_KINDS:
            msg = f"data must be one of {', '.join(_SINGLE_CELL_KINDS)}, not {data!r}."
            raise ValueError(msg)
        keep = _SINGLE_CELL_KINDS[data]
        require_matrix = data in ("matrix", "both")
        # local filters make limit count kept rows, so every page is read
        page_size = SINGLE_CELL_STUDIES_PAGE
        if limit is not None and keep is None:
            page_size = min(limit, SINGLE_CELL_STUDIES_PAGE)

        rows: list[SingleCellCorpusStudy] = []
        seen = 0
        while True:
            res = self._get_or_none(
                f"{self._base_url}/single-cell/studies",
                SingleCellStudiesResponse,
                {
                    "min_evidence": min_evidence,
                    "require_matrix": "true" if require_matrix else "false",
                    "limit": page_size,
                    "offset": offset + seen,
                },
            )
            got = res.studies if res is not None else []
            if not got:
                break
            seen += len(got)
            rows.extend(r for r in got if keep is None or r.kind in keep)
            if limit is not None and len(rows) >= limit:
                break
            # no total comes back, so a short page is the last
            if len(got) < page_size:
                break
        if limit is not None:
            rows = rows[:limit]
        if data == "any":
            reads_only = sum(r.kind == "reads_only" for r in rows)
            if reads_only:
                logger.warning(
                    "%d of %d studies have no parsed counts matrix (reads_only). "
                    "data='matrix' keeps only what a matrix can be read from; "
                    "data='fastq' keeps what can be realigned.",
                    reads_only,
                    len(rows),
                )
        return SingleCellCorpusStudies(rows)

    def fetch_single_cell_status(self, accession: str) -> SingleCellStatusResult:
        """
        Whether a study is single-cell, and the evidence behind the call.

        `kind` is matrix_and_reads, matrix_reads_unscanned, matrix_only or
        reads_only. Empty when neither the unified catalogue nor the
        Pentimento knows the accession.
        """
        res = self._get_or_none(
            f"{self._base_url}/project/{accession.strip().upper()}/single-cell/status",
            SingleCellStatus,
        )
        return SingleCellStatusResult([] if res is None else [res])

    def fetch_single_cell_summary(self, accession: str) -> SingleCellStudySummaryResult:
        """Study-level single-cell rollup; empty when not in the Pentimento."""
        res = self._get_or_none(
            f"{self._base_url}/project/{accession.strip().upper()}/single-cell/summary",
            SingleCellStudySummary,
        )
        return SingleCellStudySummaryResult([] if res is None else [res])

    def tables(self) -> pd.DataFrame:
        """Raise because the table listing describes the Parquet dump."""
        _parquet_only("tables", "The REST API has no tables to list.")

    def fetch_bams(self, accession: str) -> BamFiles:
        """
        Return the alignment files a submitter sent for a study.

        Requester-pays BAMs are listed in `BamFiles.requester_pays` because
        anonymous clients cannot fetch them.
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
        Download openly readable submitted alignment files.

        Requester-pays files are reported but not fetched. Duplicate filenames
        are prefixed with run accession. Experiment and run accessions narrow
        the study list.
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
            md5s={_normalize_url(b.open_url): b.md5 for b in open_files if b.md5},
        )
        return list(url_to_dest.values())

    def fetch_citations(
        self,
        accession: str,
        type: Literal["original", "all"] = "original",  # noqa: A002
    ) -> str:
        """
        BibTeX for papers linked to a dataset.

        `type="all"` includes reanalysis papers. No linked paper returns an
        empty string.
        """
        try:
            return self._sender(
                url=f"{self._base_url}/project/{accession}/cite",
                params={"type": type, "format": "bibtex"},
            )
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == _NOT_FOUND:
                return ""  # missing publications return an empty citation set
            raise

    def fetch_ontology_term(
        self,
        term: str,
        max_hops: int = 2,
        *,
        children: bool = True,
    ) -> OntologyTerm | None:
        """
        Look one term up in the ontology graph used for search expansion.

        Returns source identifiers, synonyms, and direct children. Missing terms
        return None. `max_hops` bounds synonyms; children are direct.

        Args:
            term: The word or phrase to look up. Case does not matter.
            max_hops: How far to walk the synonym links, 1 to 4.
            children: Set False to skip the children, which is much cheaper.

        """
        return self._get_or_none(
            f"{self._base_url}/ontology/term",
            OntologyTerm,
            {"term": term, "max_hops": max_hops, "children": children},
        )

    def map_to_ontology(
        self,
        df: pd.DataFrame,
        columns: str | Iterable[str],
        *,
        ontology: str | None = None,
        use_synonyms: bool = False,
        max_hops: int = 1,
        num_workers: int | None = None,
    ) -> pd.DataFrame:
        """
        Add ontology identifier columns for free-text labels.

        Each named column gets `<column>_ontology_id` with comma-joined CURIEs.
        Unknown labels and empty cells become NA. `use_synonyms=True` borrows
        identifiers only when the label has none, which can change specificity.

        Args:
            df: The frame to copy and annotate.
            columns: One column name, or several.
            ontology: Keep only identifiers from this source, e.g. "CL" or
                "UBERON". Default keeps all sources.
            use_synonyms: Let labels with no identifiers borrow from synonyms.
            max_hops: How far to walk synonym links, 1 to 4.
            num_workers: Threads for the lookups. One request per distinct label.

        """
        names = [columns] if isinstance(columns, str) else list(columns)
        missing = [c for c in names if c not in df.columns]
        if missing:
            msg = f"{', '.join(missing)} not in the frame"
            raise KeyError(msg)

        labels = sorted(
            {text for c in names for text in df[c].dropna().astype(str) if text.strip()}
        )
        with ThreadPoolExecutor(max_workers=_normalize_num_workers(num_workers)) as p:
            found = dict(
                zip(
                    labels,
                    p.map(
                        lambda t: self.fetch_ontology_term(t, max_hops, children=False),
                        labels,
                    ),
                    strict=True,
                )
            )
        ids = {
            k: _ontology_ids(v, ontology, use_synonyms=use_synonyms)
            for k, v in found.items()
        }

        out = df.copy()
        for c in names:
            out[f"{c}_ontology_id"] = (
                df[c].astype("object").map(lambda v: ids.get(str(v)))
            )
        return out

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
        self.download_files(
            [url for url, _ in metadata.supplementary_data],
            out_dir,
            num_workers=num_workers,
            chunk_size=chunk_size,
            with_pbar=with_pbar,
        )

    def download_files(
        self,
        urls: list[str],
        out_dir: Path,
        *,
        names: list[str] | None = None,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = False,
    ) -> None:
        """Download a bare list of URLs into out_dir, as `names` when given."""
        out_dir.mkdir(parents=True, exist_ok=True)
        url_to_dest = _url_destinations(urls, out_dir, names)
        self._download_many(url_to_dest, num_workers, chunk_size, with_pbar=with_pbar)

    def download_study_runs_data(
        self,
        runs: StudyRunsResults,
        out_dir: Path,
        mode: StudyRunDownloadMode | None = None,
        *,
        num_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        with_pbar: bool = True,
    ) -> None:
        """
        Download the read files of every run into out_dir.

        Takes the same copy per run as the R client's `download_runs()`, and the
        same files `runs.files(mode)` lists. Runs not served in `mode` are
        skipped with a warning.

        Args:
            runs: The runs to fetch, from fetch_study_runs or Dataset.runs. Pass a
                filtered list to fetch a subset.
            out_dir: Created if it does not exist.
            mode: Which copy to take: "fastq", "sra" (NCBI's full-quality copy)
                or "sra_lite" (binned quality scores). None takes the first each
                run offers, in that order.
            num_workers: Parallel downloads. Defaults to the core count less two.
            chunk_size: Bytes per read from the socket.
            with_pbar: Show a per-file progress bar.

        Raises:
            ValueError: If no run is served in `mode`, or `mode` is not one.

        """
        files = _run_files_to_fetch(runs, mode)
        self.download_files(
            [f.url for f in files],
            out_dir,
            names=[f.name for f in files],
            num_workers=num_workers,
            chunk_size=chunk_size,
            with_pbar=with_pbar,
        )

    def close(self) -> None:
        """Release client resources. The HTTP session is process-wide and stays open."""

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
