# seqout (Python Client & CLI)

A Python client library and command-line interface (CLI) for [seqout.org](https://seqout.org). Use this package to search and retrieve genomics study metadata across GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA, and download metadata, raw reads, and processed counts matrices.

Requires Python 3.13 or newer.

## Installation

Install directly from GitHub using `uv` or `pip` (specifying the `python/` subdirectory):

### Standalone command-line tool (CLI)

```bash
# Install as a global CLI tool using uv
uv tool install "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python"

# With counts-matrix reading support enabled
uv tool install "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"

# Or install using pip / pipx
pip install "git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

To run the CLI tool without a permanent installation, use `uvx`:
```bash
uvx --from "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python" seqout --help
```

### Python library

```bash
# Add as a project dependency with uv
uv add "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python"

# Add with counts-matrix reading support
uv add "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"

# Or install using pip in your active virtual environment
pip install "git+https://github.com/saketlab/seqout.git#subdirectory=python"
pip install "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

## Quick start

### Query from the command line

Run these commands to search for datasets, inspect study details, and download supplementary files:

```bash
# Search for GEO single-cell lung cancer studies, sorted by citations
seqout search "lung cancer single cell" --db geo --sort citations --max 5

# Show detailed metadata for a study
seqout show GSE149312

# Download processed supplementary files
seqout download GSE149312 --supplementary
```

### Query in Python

Open a connection using `connect()` to search and query metadata programmatically:

```python
from seqout import connect

with connect() as sq:
    dataset = sq.get("GSE149312")
    print(f"Title: {dataset.meta.title}")
    print(f"Samples: {len(dataset.samples)}")
    print(f"Runs: {len(dataset.runs)}")
```

The `Dataset` object evaluates fields lazily. It fetches data from the API only when you access a field for the first time, and caches it for future reads. It automatically resolves cross-archive links (for example, mapping a GEO series to its corresponding SRA study runs).

### Parse processed single-cell matrices

To parse supplementary files into cell-by-gene expression matrices along with harmonized donor covariates, use `seqout_counts`. This feature requires the `counts` installation extra:

```python
from seqout import seqout_counts

# Query the file manifest without downloading the files
counts = seqout_counts(gse="GSE297547")
print(counts.manifest())

# Download and parse a specific sample unit into an AnnData object
matrix = counts.matrix(sample="GSM8994520")

# Access the harmonized experimental design table
print(counts.design)
```

## Command reference summary

For the complete options list, run `seqout --help` or `seqout <command> --help`.

### Explore metadata

| Command | Action |
| --- | --- |
| `seqout search [query]` | Search for studies using free-text and metadata filters. |
| `seqout show <accession>` | Display study-level tables or detailed sample attributes. |
| `seqout pmid <pmid\|doi>` | Retrieve all datasets linked to a publication PMID or DOI. |
| `seqout author <name>` | Retrieve all datasets linked to an author. |

### Download files

| Command | Action |
| --- | --- |
| `seqout download <accession>` | Download study metadata as a JSON file. |
| `seqout download <accession> --supplementary` | Download study-level supplementary files. |
| `seqout download <accession> --sample-supplementary` | Download per-sample supplementary files. |
| `seqout download <accession> --fastq` | Download raw sequencing reads (supports `--sra`, `--sra-lite`, `--s3`, `--gcs`). |

### Map accessions

| Command | Action |
| --- | --- |
| `seqout convert <accession>... --to <kind>` | Map accessions to other types (e.g., `study`, `sample`, `run`). |
| `seqout gse-to-srp <accession>...` | Shorthand helper to convert GEO Series accessions to SRA Study accessions. |

### Offline SQL queries (Parquet backend)

| Command | Action |
| --- | --- |
| `seqout parquet download <dir>` | Download the published database Parquet files to a directory. |
| `seqout parquet query "<sql>"` | Run custom SQL queries against the Parquet files using DuckDB. |
| `seqout parquet show <accession>` | Inspect studies, samples, or experiments offline. |
| `seqout parquet set-source <url\|dir>` | Save a default local or remote source directory. |

To run standard CLI commands offline, append the `--parquet` flag (e.g., `seqout show GSE12345 --parquet`).
