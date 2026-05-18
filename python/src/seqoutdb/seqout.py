from typing import Iterator

import httpx

from seqoutdb._internal._constants import BASE_URL
from seqoutdb._internal._utils import _send_get_req
from seqoutdb.models import SearchParams, SearchResponse, SearchResult, SearchResults


class Seqout:
    def __init__(
        self, http_client: httpx.Client | None = None, base_url=BASE_URL
    ) -> None:
        self._client = httpx.Client()
        # is the http client created by seqout?
        self._own_client = http_client is None
        self._base_url = base_url

    # internal method for accessing `/search` endpoint
    def _search(self, params: SearchParams) -> SearchResponse:
        response = _send_get_req(
            client=self._client,
            url=f"{self._base_url}/search",
            params=params,
            response_model=SearchResponse,
        )
        return response

    def search(self, params: SearchParams) -> SearchResults:
        response = self._search(params)
        return response.to_results()

    def search_all(
        self, params: SearchParams, limit: int | None = None
    ) -> Iterator[SearchResult]:
        fetched = 0

        while True:
            response = self._search(params)
            for res in response.results:
                if limit is not None and fetched >= limit:
                    return

                yield res
                fetched += 1

            if not response.next_cursor:
                break

            params = params.model_copy(
                update={
                    "cursor_rank": response.next_cursor.rank,
                    "cursor_acc": response.next_cursor.accession,
                },
            )

    def close(self) -> None:
        if self._own_client:
            # close the http client only if it was created seqout class
            # if user passes his own instance of http client then it is not closed
            self._client.close()

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
