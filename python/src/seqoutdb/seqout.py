import functools
import itertools
import os
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from typing import Iterator

import httpx

from seqoutdb.constants import BASE_URL
from seqoutdb.models import (
    ExperimentSample,
    ExperimentSampleList,
    ProjectCrossReferenceResponse,
    ProjectCrossReferenceResult,
    ProjectMetadataResult,
    SearchParams,
    SearchResponse,
    SearchResult,
    SearchResults,
    StructuredSearchParams,
)
from seqoutdb.utils import _send_get_req

SearchParamsType = SearchParams | StructuredSearchParams

DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_FACTOR = 2.0
DEFAULT_TIMEOUT = 30


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

    def _search(
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

    def _search_paginate(
        self,
        params: SearchParamsType,
    ) -> Iterator[SearchResult]:
        while True:
            response = self._search(
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
        response = self._search(
            params,
        )

        return response.to_results()

    def search_all(
        self,
        params: SearchParamsType,
        limit: int | None = None,
    ) -> Iterator[SearchResult]:
        iterator = self._search_paginate(params)
        if limit is None:
            yield from iterator
        else:
            yield from itertools.islice(iterator, limit)

    def bulk_search(
        self,
        params: list[SearchParamsType],
        n_workers: int | None = None,
    ) -> dict[int, SearchResults]:
        if n_workers is None:
            cpu_count = os.cpu_count()
            n_workers = cpu_count - 2 if cpu_count else None
            if n_workers is None:
                raise SystemError("failed to fetch cpu count")

        def _do_search(params: SearchParamsType) -> SearchResults:
            return self.search(params)

        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futures: dict[Future[SearchResults], int] = {
                pool.submit(_do_search, p): i for i, p in enumerate(params)
            }
            results: dict[int, SearchResults] = {}

            for f in as_completed(futures):
                idx = futures[f]
                results[idx] = f.result()

        return results

    def metadata_by_accession(self, accession_id: str) -> ProjectMetadataResult:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}/metadata",
            params=None,
            response_model=ProjectMetadataResult,
        )

        return response

    def samples_by_accession(self, accession_id: str) -> list[ExperimentSample]:
        if not accession_id.startswith("GSE") and not accession_id.startswith("E-"):
            raise ValueError(
                "samples can be only fetched for GEO series and ArrayExpress experiment"
            )

        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/geo/series/{accession_id}/samples",
            params=None,
            response_model=ExperimentSampleList,
        )

        return response.root

    def cross_reference_lookup_by_accession(
        self, accession_id: str
    ) -> list[ProjectCrossReferenceResult]:
        response = self._sender(
            client=self._client,
            url=f"{self._base_url}/project/{accession_id}/xref",
            params=None,
            response_model=ProjectCrossReferenceResponse,
        )

        return response.xref

    def close(self) -> None:
        if self._own_client:
            # close the http client only if it was created seqout class
            # if user passes his own instance of http client then it is not closed
            self._client.close()

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
