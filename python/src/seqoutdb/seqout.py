from typing import Any, Literal, overload

from seqoutdb.clients.api import SeqoutAPIClient
from seqoutdb.clients.parquet import SeqoutParquetClient


@overload
def connect_to_seqout(backend: Literal["api"], **kwargs: Any) -> SeqoutAPIClient: ...
@overload
def connect_to_seqout(
    backend: Literal["parquet"], **kwargs: Any
) -> SeqoutParquetClient: ...


def connect_to_seqout(
    backend: Literal["api", "parquet"] = "api", **kwargs: Any
) -> SeqoutAPIClient | SeqoutParquetClient:
    match backend:
        case "api":
            return SeqoutAPIClient(**kwargs)
        case "parquet":
            return SeqoutParquetClient(**kwargs)
