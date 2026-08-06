from typing import Any, Literal, overload

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient

# back-compat alias; cli.py and norm.py still import the old name
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
    Open a client against one of the two backends.

    Both clients expose the same method names and return the same models, so
    code written against one runs against the other. The choice is always
    explicit: a silent switch to Parquet would turn a lookup into a multi-GB
    scan. Each client is a context manager.

        with connect() as sq:
            d = sq.get("GSE168652")

    Args:
        backend: "api" reads seqout.org over HTTP and is always current.
            "parquet" reads the published Parquet dump with DuckDB, works
            offline, and answers SQL, at the cost of some methods and of speed
            over a remote URL.
        **kwargs: Passed to the client, e.g. base_url or timeout for the API
            client, source for the Parquet one.

    Returns:
        A SeqoutAPIClient or a SeqoutParquetClient.

    """
    match backend:
        case "api":
            return SeqoutAPIClient(**kwargs)
        case "parquet":
            return SeqoutParquetClient(**kwargs)


connect = connect_to_seqout
