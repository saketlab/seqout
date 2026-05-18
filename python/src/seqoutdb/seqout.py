import itertools
from typing import Iterator

import httpx

from seqoutdb._internal._constants import BASE_URL
from seqoutdb._internal._utils import _send_get_req
from seqoutdb.models import (
    SearchParams,
    SearchResponse,
    SearchResult,
    SearchResults,
    SearchStructuredParams,
)

SearchParamsType = SearchParams | SearchStructuredParams


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
        is_structured = isinstance(params, SearchStructuredParams)
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
        max_attempts: int = 3,
        backoff_factor: float = 2.0,
        timeout: int = 30,
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
        max_attempts: int = 3,
        backoff_factor: float = 2.0,
        timeout: int = 30,
    ) -> Iterator[SearchResult]:
        iterator = self._search_paginate(params, max_attempts, backoff_factor, timeout)
        if limit is None:
            yield from iterator
        else:
            yield from itertools.islice(iterator, limit)

    def close(self) -> None:
        if self._own_client:
            # close the http client only if it was created seqout class
            # if user passes his own instance of http client then it is not closed
            self._client.close()

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
