import functools
import itertools
from collections.abc import Iterator
from concurrent.futures import (
    Future,
    ThreadPoolExecutor,
    as_completed,
)
from pathlib import Path
from typing import Literal, Self

import requests

from seqout.constants import (
    API_BASE_URL,
    DEFAULT_DOWNLOAD_CHUNK_SIZE,
    DEFAULT_MAX_WAIT,
    DEFAULT_NUM_RETRIES,
    DEFAULT_REQ_TIMEOUT,
)
from seqout.helpers import (
    _download_file,
    _send_req,
)
from seqout.models.api_models import (
    AccessionClassification,
    AuthorProjectsResponse,
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
# study/project accession prefixes across SRA, ENA, DDBJ, GSA and BioProjects.
_STUDY_PREFIXES = ("SRP", "ERP", "DRP", "CRA", "HRA", "PRJ")


class SeqoutAPIClient:
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
        params: SearchParamsType,
    ) -> tuple[SearchCorrection | None, Iterator[SearchResult]]:
        """Return page 0's spelling correction plus the full result iterator.

        The correction (``did you mean`` / augmented extra matches) only rides on
        the first page; this reuses that page so paging costs no extra request.
        """
        first = self._fetch_search_page(params)
        return first.correction, self._iter_search_pages(params, first=first)

    def search(
        self,
        params: SearchParamsType,
    ) -> SearchResults:
        response = self._fetch_search_page(
            params,
        )

        return response.to_results()

    def iter_search(
        self,
        params: SearchParamsType,
        limit: int | None = None,
    ) -> Iterator[SearchResult]:
        iterator = self._iter_search_pages(params)
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
            if exc.response and exc.response.status_code == _NOT_FOUND:
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

    # --- resolvers: same names as SeqoutParquetClient so the CLI's shared
    # conversion/download helpers are backend-agnostic (call sq.<method>). ---

    def resolve_study(self, accession: str) -> str | None:
        """Resolve a child accession (run/experiment/sample) to its study root."""
        if accession.upper().startswith(_STUDY_PREFIXES):
            return accession
        try:
            res = self.search(SearchParams(q=accession))
        except Exception:
            return None
        for r in res:
            if r.accession.upper().startswith(_STUDY_PREFIXES):
                return r.accession
        return None

    def linked_study(self, accession: str) -> str | None:
        """Return a GEO/AE series' linked SRA (preferred) or other study, via xref."""
        try:
            cands = [
                r.accession
                for r in self.fetch_cross_references(accession)
                if r.accession.upper().startswith(_STUDY_PREFIXES)
            ]
        except Exception:
            return None
        for c in cands:  # prefer a real study accession over a BioProject
            if c.upper().startswith(("SRP", "ERP", "DRP")):
                return c
        return cands[0] if cands else None

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
            if exc.response and exc.response.status_code == _NOT_FOUND:
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
