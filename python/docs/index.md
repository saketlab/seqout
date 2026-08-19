---
description: "Python library and command-line client for seqout.org: query and download metadata from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA."
---

# Home

`seqout` is a Python client for [seqout.org](https://seqout.org). Use this package to search, retrieve, and download metadata and datasets from seven major public genomic archives:
*   Gene Expression Omnibus (GEO)
*   Sequence Read Archive (SRA)
*   European Nucleotide Archive (ENA)
*   ArrayExpress
*   DNA Data Bank of Japan (DDBJ DRA and GEA)
*   Genome Sequence Archive (GSA)

The package provides two components:
1.  **Command-Line Interface (CLI):** A terminal tool (`seqout`) for interactive search, metadata inspection, accession mapping, and batch downloads.
2.  **Python Library:** A programmatic API (`import seqout`) for integrating metadata queries and matrix parsing into your analysis scripts.

## Choose a backend

The package supports two data retrieval backends:

| Backend | Mechanism | Best Use Cases |
| --- | --- | --- |
| **API** (Default) | Queries the `seqout.org` REST API over HTTP. | Standard workflows. The data is always up-to-date. |
| **Parquet** | Queries the published Parquet database dump using DuckDB. | Offline workflows, large batch queries, and custom SQL analytics. |

The Parquet backend executes queries locally without sending HTTP requests to the REST API. You can read database files directly from a local directory or a remote static server. For more details, see [Parquet backend](parquet.md).

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

To load study details, pass any supported archive accession (such as a GSE series or SRP study ID) to the `get` method. The client automatically resolves linked records across different archives:

```python
with connect() as sq:
    dataset = sq.get("GSE168652")
    print(f"Title: {dataset.meta.title}")
    print(f"Samples: {len(dataset.samples)}")
    print(f"Runs: {len(dataset.runs)}")
```

## Next steps

*   [Installation](installation.md) — Guide to installing the library, CLI, and optional components.
*   [Command-Line Interface](cli.md) — Detailed reference for CLI commands and flags.
*   [Python Library](library.md) — Reference guide for programmatic metadata queries and downloads.
*   [Parquet Backend](parquet.md) — Running offline SQL queries on Parquet database dumps.
*   [API Reference](reference/index.md) — Documentation for public functions, classes, and models.
