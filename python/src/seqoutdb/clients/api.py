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

from seqoutdb.constants import (
    API_BASE_URL,
    DEFAULT_DOWNLOAD_CHUNK_SIZE,
    DEFAULT_MAX_WAIT,
    DEFAULT_NUM_RETRIES,
    DEFAULT_REQ_TIMEOUT,
)
from seqoutdb.helpers import (
    _download_file,
    _send_req,
)
from seqoutdb.models.api_models import (
    AccessionClassification,
    ExperimentSampleList,
    GeoSampleDetailedMetadata,
    ProjectCrossReferenceList,
    ProjectCrossReferenceResponse,
    ProjectLLMEnrichedSampleMetadataResponse,
    ProjectLLMEnrichedSampleMetadataResults,
    ProjectMetadataResult,
    ProjectSummaryResult,
    ProjectSummaryResultList,
    SampleDetailedMetadata,
    SampleMetadataResult,
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
from seqoutdb.utils import (
    _extract_download_info_for_study_run,
    _normalize_num_workers,
    _normalize_url,
    _validate_study_runs_data,
)

SearchParamsType = SearchParams | StructuredSearchParams
_NOT_FOUND = 404


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
    ) -> Iterator[SearchResult]:
        while True:
            response = self._fetch_search_page(
                params,
            )
            yield from response.results

            if not response.next_cursor:
                break

            update = {"cursor_acc": response.next_cursor.accession}
            if response.next_cursor.sort_value is not None:
                update["cursor_sort"] = response.next_cursor.sort_value
            else:
                update["cursor_rank"] = response.next_cursor.rank
            params = params.model_copy(update=update)

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

    def fetch_study_runs(self, study_id: str) -> StudyRunsResults:
        response = self._sender(
            url=f"{self._base_url}/project/{study_id}/runs",
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
