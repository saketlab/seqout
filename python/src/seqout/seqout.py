from typing import Any, Literal, overload

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient

# ponytail: back-compat alias — cli.py/norm.py still import the old name.
Seqout = SeqoutAPIClient


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
