import functools
import itertools
from concurrent.futures import (
    Future,
    ProcessPoolExecutor,
    as_completed,
)
from multiprocessing import Manager
from pathlib import Path
from queue import Queue
from typing import Iterator

import httpx
from tqdm import tqdm

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
)
from seqoutdb.utils import _download_file, _send_get_req, _validate_num_workers

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
            params=None,
            response_model=ProjectSummaryResult,
        )

        return response

    def fetch_project_metadata(self, accession_id: str) -> ProjectMetadataResult:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}",
            params=None,
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
            params=None,
            response_model=ExperimentSampleList,
        )

        return response

    def fetch_cross_references(self, accession_id: str) -> ProjectCrossReferenceList:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}/xref",
            params=None,
            response_model=ProjectCrossReferenceResponse,
        )

        return response.xref

    def download_supplementary_data(
        self,
        metadata: ProjectMetadataResult,
        out_dir: Path,
        n_workers: int | None = None,
        chunk_size: int = DEFAULT_DOWNLOAD_CHUNK_SIZE,
        verbose: bool = True,
    ):
        n_workers = _validate_num_workers(n_workers)
        failed: list[tuple[str, Exception]] = []

        with Manager() as manager:
            queue: Queue[tuple[str, str, int | None]] | None = (
                manager.Queue() if verbose else None
            )

            with ProcessPoolExecutor(max_workers=n_workers) as pool:
                futures = {}
                pbars = {}

                for link, _ in metadata.supplementary_data:
                    if link.startswith("ftp://"):
                        link = link.replace(
                            "ftp://", "https://"
                        )  # download file over https instead of ftp

                    dest_path = out_dir / Path(link.split("/")[-1])
                    futures[
                        pool.submit(_download_file, link, dest_path, chunk_size, queue)
                    ] = link

                if queue:
                    pbars: dict[str, tqdm] = {}
                    pending = len(futures)

                    while pending > 0:
                        msg = queue.get()
                        url, kind, value = msg

                        if kind == "total":
                            pbars[url] = tqdm(
                                total=value,
                                unit="B",
                                unit_scale=True,
                                unit_divisor=1024,
                                desc=dest_path.name,
                            )
                        elif kind == "update":
                            pbars[url].update(value)
                        elif kind == "done":
                            pbars[url].close()
                            pending -= 1

                for future, url in futures.items():
                    try:
                        future.result()
                    except Exception as e:
                        failed.append((url, e))

        if failed:
            summary = "\n".join(f"  {url}: {e}" for url, e in failed)
            raise RuntimeError(f"{len(failed)} download(s) failed:\n{summary}")

    def fetch_project_enriched_metadata(
        self, accession_id: str
    ) -> ProjectLLMEnrichedSampleMetadataResults:
        response = self._sender(
            client=self._client,
            url=f"https://seqout.org/api/project/{accession_id}/enriched",
            params=None,
            response_model=ProjectLLMEnrichedSampleMetadataResponse,
        )

        return response.samples

    def close(self) -> None:
        if self._own_client:
            # close the http client only if it was created seqout class
            # if user passes his own instance of http client then it is not closed
            self._client.close()

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
