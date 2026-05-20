import functools
import itertools
from concurrent.futures import (
    Future,
    ProcessPoolExecutor,
    as_completed,
)
from multiprocessing import Manager
from pathlib import Path
from typing import Iterator, Literal

import httpx

from seqoutdb import StudyExperimentsResults, StudyRunsResults
from seqoutdb.constants import BASE_URL
from seqoutdb.models import (
    ExperimentSampleList,
    ProjectCrossReferenceList,
    ProjectCrossReferenceResponse,
    ProjectLLMEnrichedSampleMetadataResponse,
    ProjectLLMEnrichedSampleMetadataResults,
    ProjectMetadataResult,
    ProjectSummaryResult,
    SearchParams,
    SearchResponse,
    SearchResult,
    SearchResults,
    StructuredSearchParams,
    StudyRunsResponse,
)
from seqoutdb.utils import (
    _download_file,
    _extract_download_info_for_study_run,
    _normalize_url,
    _run_parallel_downloads,
    _send_get_req,
    _validate_num_workers,
    _validate_study_runs_data,
)

SearchParamsType = SearchParams | StructuredSearchParams

DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_FACTOR = 2.0
DEFAULT_TIMEOUT = 30
DEFAULT_DOWNLOAD_CHUNK_SIZE = 1024


class Seqout:
    def __init__(
        self,
        http_client: httpx.Client | None = None,
        base_url=BASE_URL,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        backoff_factor: float = DEFAULT_BACKOFF_FACTOR,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        self._client = http_client or httpx.Client()
        # is the http client created by seqout?
        self._own_client = http_client is None
        self._base_url = base_url

        self.max_attempts = max_attempts
        self.backoff_factor = backoff_factor
        self.timeout = timeout

        self._sender = functools.partial(
            _send_get_req,
            max_attempts=self.max_attempts,
            backoff_factor=self.backoff_factor,
            timeout=self.timeout,
        )

    def _fetch_search_page(
        self,
        params: SearchParamsType,
    ) -> SearchResponse:
        is_structured = isinstance(params, StructuredSearchParams)
        response = self._sender(
            client=self._client,
            url=(
                f"{self._base_url}/search"
                if not is_structured
                else f"{self._base_url}/search/structured"
            ),
            params=params,
            response_model=SearchResponse,
        )

        return response

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

            params = params.model_copy(
                update={
                    "cursor_rank": response.next_cursor.rank,
                    "cursor_acc": response.next_cursor.accession,
                }
            )

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
        n_workers: int | None = None,
    ) -> dict[int, SearchResults]:
        n_workers = _validate_num_workers(n_workers)

        def _do_search(params: SearchParamsType) -> SearchResults:
            return self.search(params)

        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            futures: dict[Future[SearchResults], int] = {
                pool.submit(_do_search, p): i for i, p in enumerate(params)
            }
            results: dict[int, SearchResults] = {}

            for f in as_completed(futures):
                idx = futures[f]
                results[idx] = f.result()

        return results

    def fetch_project_summary(self, accession_id: str) -> ProjectSummaryResult:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}/metadata",
            response_model=ProjectSummaryResult,
        )

        return response

    def fetch_project_metadata(self, accession_id: str) -> ProjectMetadataResult:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}",
            response_model=ProjectMetadataResult,
        )

        return response

    def fetch_samples(self, accession_id: str) -> ExperimentSampleList:
        if not accession_id.startswith("GSE") and not accession_id.startswith("E-"):
            raise ValueError(
                "samples can be only fetched for GEO series and ArrayExpress experiments"
            )

        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/geo/series/{accession_id}/samples",
            response_model=ExperimentSampleList,
        )

        return response

    def fetch_cross_references(self, accession_id: str) -> ProjectCrossReferenceList:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}/xref",
            response_model=ProjectCrossReferenceResponse,
        )

        return response.xref

    def fetch_project_enriched_metadata(
        self, accession_id: str
    ) -> ProjectLLMEnrichedSampleMetadataResults:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}/enriched",
            response_model=ProjectLLMEnrichedSampleMetadataResponse,
        )

        return response.samples

    def fetch_study_experiments(self, study_id: str) -> StudyExperimentsResults:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{study_id}/experiments",
            response_model=StudyExperimentsResults,
        )

        return response

    def fetch_study_runs(self, study_id: str) -> StudyRunsResults:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{study_id}/runs",
            response_model=StudyRunsResponse,
        )

        return response.runs

    def download_project_supplementary_data(
        self,
        metadata: ProjectMetadataResult,
        out_dir: Path,
        n_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        verbose: bool = True,
    ):
        n_workers = _validate_num_workers(n_workers)
        out_dir.mkdir(parents=True, exist_ok=True)

        all_urls: list[str] = []
        url_to_dest: dict[str, Path] = {}

        for url, _ in metadata.supplementary_data:
            url = _normalize_url(url)
            all_urls.append(url)
            url_to_dest[url] = out_dir / Path(url.split("/")[-1])

        with Manager() as manager:
            queue = manager.Queue() if verbose else None

            with ProcessPoolExecutor(max_workers=n_workers) as pool:
                futures: dict[Future, str] = {
                    pool.submit(
                        _download_file, url, url_to_dest[url], chunk_size, queue
                    ): url
                    for url in all_urls
                }

                failed = _run_parallel_downloads(
                    futures,
                    queue,
                    url_to_dest,
                )

        if failed:
            summary = "\n".join(f"  {url}: {e}" for url, e in failed)
            raise RuntimeError(f"{len(failed)} download(s) failed:\n{summary}")

    def download_study_runs_data(
        self,
        runs: StudyRunsResults,
        out_dir: Path,
        mode: Literal["fastq", "sra", "sra_lite", "s3", "gcs"],
        n_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        verbose: bool = True,
    ):
        _validate_study_runs_data(runs, mode)
        n_workers = _validate_num_workers(n_workers)
        out_dir.mkdir(parents=True, exist_ok=True)

        all_urls: list[str] = []
        url_to_bytes_and_checksum: dict[str, tuple[int, str]] = {}
        url_to_dest: dict[str, Path] = {}

        for r in runs:
            run_urls, run_bytes, run_md5s = _extract_download_info_for_study_run(
                r, mode
            )

            if not run_urls or not run_bytes or not run_md5s:
                raise ValueError(
                    f"failed to extract download info for {r.run_accession}"
                )

            for i, url in enumerate(run_urls):
                url = _normalize_url(url)
                all_urls.append(url)
                url_to_bytes_and_checksum[url] = (int(run_bytes[i]), run_md5s[i])
                url_to_dest[url] = out_dir / Path(url.split("/")[-1])

        with Manager() as manager:
            queue = manager.Queue() if verbose else None

            with ProcessPoolExecutor(max_workers=n_workers) as pool:
                futures: dict[Future, str] = {
                    pool.submit(
                        _download_file, url, url_to_dest[url], chunk_size, queue
                    ): url
                    for url in all_urls
                }

                failed = _run_parallel_downloads(
                    futures, queue, url_to_dest, url_to_bytes_and_checksum
                )

        if failed:
            summary = "\n".join(f"  {url}: {e}" for url, e in failed)
            raise RuntimeError(f"{len(failed)} download(s) failed:\n{summary}")

    def close(self) -> None:
        if self._own_client:
            # close the http client only if it was created seqout class
            # if user passes his own instance of http client then it is not closed
            self._client.close()

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
