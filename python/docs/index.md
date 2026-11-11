---
description: "Python library and command-line client for seqout.org: query and download metadata from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA."
---

# Home

`seqout` is a Python client for [seqout.org](https://seqout.org). It can search and download datasets from seven public genomic archives: GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress.


This package provides two components: a **CLI tool** and a **library** that can be used in scripts.

Installation instructions are documented in its [dedicated page](installation.md).

## Choose a backend

This package supports two data retrieval backends:

| Backend | Mechanism | Best Use Cases |
| --- | --- | --- |
| **API** (Default) | Queries the `seqout.org` REST API over HTTP. | Queries against the live index. |
| **Parquet** | Queries the published Parquet database dump using DuckDB. | Offline workflows, large batch queries, and custom SQL analytics. |

The Parquet backend executes queries locally without sending HTTP requests to [Seqout's REST API](https://seqout.org/api-docs). You can also read database files directly from a local directory or a remote static server. For more details, read [Parquet backend](parquet.md).

## Quick start

### Query from the command line

Search for GEO datasets matching a query string:

```bash
seqout search "lung cancer single cell" --db geo
```

### Query in Python

Perform the same search programmatically:

```python
from seqout import connect

with connect() as sq:
    results = sq.search("lung cancer single cell", db="geo")
    for r in results:
        print(r.accession, r.title)
```

### View dataset details

To load dataset details, use the `show` subcommand on the CLI:

```bash
seqout show GSE168652
```
or pass the accession ID to the `get` method. 

```python
with connect() as sq:
    dataset = sq.get("GSE168652")
    print(f"Title: {dataset.meta.title}")
    print(f"Samples: {len(dataset.samples)}")
    print(f"Runs: {len(dataset.runs)}")
```

`seqout` automatically resolves the archive from the accession identifier, so this works for any accession.

## Next steps

* [Installation](installation.md): install the library, CLI, and optional components.
* [Command-Line Interface](cli.md): CLI commands and flags.
* [Python Library](library.md): programmatic metadata queries and downloads.
* [Parquet Backend](parquet.md): offline SQL queries on Parquet database dumps.
* [API Reference](reference/index.md): public functions, classes, and models.
