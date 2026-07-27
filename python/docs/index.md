# seqout

`seqout` is a Python client for [seqout.org](https://seqout.org). It gets
metadata about high-throughput sequencing datasets from seven public
repositories: GEO, SRA, ArrayExpress, ENA, GSA, DRA, and GEA.

The client has two parts:

- A **command-line tool** (`seqout`). Use it to search, to show a dataset, to
  convert accessions, and to download data.
- A **Python library** (`import seqout`). Use it to do the same tasks in your
  own code.

## Two backends

`seqout` can get data in two ways:

| Backend | How it works | When to use it |
| --- | --- | --- |
| **API** (default) | It calls the seqout.org web API. | Normal use. It is always up to date. |
| **Parquet** | It reads Parquet data dumps with DuckDB. | Offline or local use, and large batch jobs. |

The Parquet backend needs no network to the API. It reads the data files
directly. The files can be on a remote server or in a local directory. For more
information, see [Parquet backend](parquet.md).

## A quick example

Search for datasets from the command line:

```bash
seqout search "lung cancer single cell" --db geo
```

Or do the same task in Python:

```python
from seqout import connect_to_seqout, SearchParams

with connect_to_seqout(backend="api") as sq:
    results = sq.search(SearchParams(q="lung cancer single cell", db="geo"))
    for r in results:
        print(r.accession, r.title)
```

## Next steps

- [Installation](installation.md) — how to install the client.
- [Command line](cli.md) — every command and its options.
- [Python library](library.md) — how to use the library in your code.
- [Parquet backend](parquet.md) — how to use local or remote Parquet data.

---

