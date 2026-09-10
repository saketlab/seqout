from typing import Any, Literal, overload

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient

# public alias imported by cli.py and norm.py
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
    """
    Open an API or Parquet client.

    The backend is explicit because Parquet can scan a large remote dump. Each
    client is a context manager.

        with connect() as sq:
            d = sq.get("GSE168652")

    Args:
        backend: "api" reads seqout.org over HTTP. "parquet" reads the
            published Parquet dump with DuckDB and supports SQL.
        **kwargs: Passed to the selected client.

    Returns:
        A SeqoutAPIClient or SeqoutParquetClient.

    """
    match backend:
        case "api":
            return SeqoutAPIClient(**kwargs)
        case "parquet":
            return SeqoutParquetClient(**kwargs)


connect = connect_to_seqout
