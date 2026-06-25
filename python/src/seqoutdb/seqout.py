from typing import Literal, overload

from seqoutdb.clients.api import SeqoutAPIClient
from seqoutdb.clients.parquet import SeqoutParquetClient


@overload
def connect_to_seqout(backend: Literal["api"], **kwargs) -> SeqoutAPIClient: ...
@overload
def connect_to_seqout(backend: Literal["parquet"], **kwargs) -> SeqoutParquetClient: ...


def connect_to_seqout(backend: Literal["api", "parquet"] = "api", **kwargs):
    match backend:
        case "api":
            return SeqoutAPIClient(**kwargs)
        case "parquet":
            return SeqoutParquetClient(**kwargs)
