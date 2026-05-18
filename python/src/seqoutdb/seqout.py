import httpx

from seqoutdb._internal._constants import BASE_URL
from seqoutdb.models import SearchParams, SearchResponse


class Seqout:
    def __init__(
        self, http_client: httpx.Client | None = None, base_url=BASE_URL
    ) -> None:
        self._client = httpx.Client()
        self._own_client = http_client is None  # is the http client created by seqout?
        self._base_url = base_url

    def search(self, params: SearchParams) -> SearchResponse:
        response = self._client.get(
            f"{self._base_url}/search", params=params.model_dump(exclude_none=True)
        )

        response.raise_for_status()
        return SearchResponse.model_validate(response.json())

    def close(self) -> None:
        if self._own_client:
            self._client.close()  # close the http client only if it was created by seqout. as if it was created by the user then he might use it elsewhere

    def __enter__(self) -> "Seqout":
        return self

    def __exit__(self, *args) -> None:
        self.close()
