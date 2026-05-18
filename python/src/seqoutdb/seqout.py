import itertools
import os
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from typing import Iterator

import httpx

from seqoutdb._internal._constants import BASE_URL
from seqoutdb._internal._utils import _send_get_req
from seqoutdb.models import (
    SearchParams,
    SearchResponse,
    SearchResult,
    SearchResults,
    StructuredSearchParams,
)

SearchParamsType = SearchParams | StructuredSearchParams

DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_FACTOR = 2.0
DEFAULT_TIMEOUT = 30


class Seqout:
    def __init__(
        self, http_client: httpx.Client | None = None, base_url=BASE_URL
    ) -> None:
        self._client = http_client or httpx.Client()
        # is the http client created by seqout?
        self._own_client = http_client is None
        self._base_url = base_url

    def _search(
        self,
        params: SearchParamsType,
        max_attempts: int,
        backoff_factor: float,
        timeout: int,
    ) -> SearchResponse:
        is_structured = isinstance(params, StructuredSearchParams)
        response = _send_get_req(
            client=self._client,
            url=(
                f"{self._base_url}/search"
                if not is_structured
                else f"{self._base_url}/search/structured"
            ),
            params=params,
            response_model=SearchResponse,
            max_attempts=max_attempts,
            backoff_factor=backoff_factor,
            timeout=timeout,
        )

        return response

    def _search_paginate(
        self,
        params: SearchParamsType,
        max_attempts: int,
        backoff_factor: float,
        timeout: int,
    ) -> Iterator[SearchResult]:
        while True:
            response = self._search(
                params=params,
                max_attempts=max_attempts,
                backoff_factor=backoff_factor,
                timeout=timeout,
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
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        backoff_factor: float = DEFAULT_BACKOFF_FACTOR,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> SearchResults:
        response = self._search(
            params=params,
            max_attempts=max_attempts,
            backoff_factor=backoff_factor,
            timeout=timeout,
        )

        return response.to_results()

    def search_all(
        self,
        params: SearchParamsType,
        limit: int | None = None,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        backoff_factor: float = DEFAULT_BACKOFF_FACTOR,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> Iterator[SearchResult]:
        iterator = self._search_paginate(params, max_attempts, backoff_factor, timeout)
        if limit is None:
            yield from iterator
        else:
            yield from itertools.islice(iterator, limit)

    def bulk_search(
        self,
        params: list[SearchParamsType],
        n_workers: int | None = None,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        backoff_factor: float = DEFAULT_BACKOFF_FACTOR,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict[int, SearchResults]:
        if n_workers is None:
            cpu_count = os.cpu_count()
            n_workers = cpu_count - 2 if cpu_count else None

        if n_workers is None:
            raise SystemError("failed to fetch cpu count")

        def _do_search(params: SearchParamsType) -> SearchResults:
            return self.search(params, max_attempts, backoff_factor, timeout)

        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futures: dict[Future[SearchResults], int] = {
                pool.submit(_do_search, p): i for i, p in enumerate(params)
            }
            results: dict[int, SearchResults] = {}

            for f in as_completed(futures):
                idx = futures[f]
                results[idx] = f.result()

        return results

    def close(self) -> None:
        if self._own_client:
            # close the http client only if it was created seqout class
            # if user passes his own instance of http client then it is not closed
            self._client.close()

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
