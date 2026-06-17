# seqoutDB

A Python client and command-line tool for [seqout.org](https://seqout.org) — search and explore
genomic study metadata from **GEO**, **SRA**, **ArrayExpress**, and **ENA**, and download both
metadata and raw data files from a single, consistent interface.

It comes in two parts that share the same engine:

- **`seqoutdb`** — a friendly command-line tool for everyday lookups and downloads.
- **`seqoutdb` (the library)** — a typed Python API for use in scripts, notebooks, and pipelines.

---

## Installation

All you need is [uv](https://docs.astral.sh/uv/).

**As a command-line tool** — install it globally with `uv tool`:

```bash
uv tool install seqoutdb
seqoutdb --help
```

This puts `seqoutdb` on your PATH, isolated from your projects. Upgrade with
`uv tool upgrade seqoutdb`. You can also run it without installing via `uvx seqoutdb …`.

**As a library** in your own project:

```bash
uv add seqoutdb
```

**From source** (for development):

```bash
git clone https://github.com/your-org/seqoutDB.git
cd seqoutDB/python
uv sync
uv run seqoutdb --help
```

From a source checkout, anything shown below as `seqoutdb …` can be run as `uv run seqoutdb …`.

Requires Python 3.13 or newer.

---

## Command-line tool

The CLI is organized around a few clear verbs. Run `seqoutdb --help` (or `seqoutdb <command> --help`)
at any time.

| Command | Purpose |
| --- | --- |
| `seqoutdb search <query>` | Full-text search across all sources |
| `seqoutdb show <accession>` | Inspect a project (table) or a sample (detail view) |
| `seqoutdb download <accession>` | Download metadata, supplementary files, or sequencing reads |

### Search

```bash
# Search everything
seqoutdb search "lung cancer single cell"

# Narrow to one source, sort by citations, cap the results
seqoutdb search "covid intestine" --db geo --sort citations -n 5
```

| Option | Description |
| --- | --- |
| `--db {geo,sra,arrayexpress,ena}` | Restrict to a single source (default: all) |
| `--sort {citations,journal,year}` | Order the results |
| `-n`, `--limit` | Maximum results to show (default: 20) |

Each result prints its accession, source, title, organisms, and citation count — pass any accession
straight to `show` or `download`.

### Show

`show` adapts to what you give it.

```bash
# A project → a table of its samples (GEO/ArrayExpress) or experiments (SRA/ENA)
seqoutdb show GSE149312
seqoutdb show SRP324458
seqoutdb show E-GEOD-18544

# A sample → a detailed field-by-field view, including its characteristics/attributes
seqoutdb show GSM8241457
seqoutdb show SRX11169657
```

### Download

By default `download` saves **metadata** as JSON. Flags switch it to downloading **files**.

```bash
# Metadata → ./GSE149312.json   (project + all of its samples)
seqoutdb download GSE149312

# Sample metadata → ./GSM8241457.json
seqoutdb download GSM8241457

# Choose the destination (file or directory)
seqoutdb download SRP324458 -o ./study/
```

**Supplementary files** (processed data, matrices, archives):

```bash
seqoutdb download GSE149312 --supplementary
```

**Sequencing reads** (`--fastq`, plus `--sra`, `--sra-lite`, `--s3`, `--gcs`):

```bash
# Every run in a study
seqoutdb download SRP324458 --fastq

# A single run — pick exactly which files to download, interactively
seqoutdb download SRR14851096 --fastq
```

A few conveniences worth knowing:

- **Cross-accession resolution.** Ask for the "wrong" kind and it figures out the link for you:
  `download GSE… --fastq` follows the series to its SRA study, and `download SRP… --supplementary`
  follows the study back to its GEO series.
- **Per-file selection.** For a single run, a checkbox prompt (space to toggle, enter to confirm)
  lets you choose which files to pull.
- **Interleaved paired-end warning.** When a paired-end run ships as one interleaved file, you'll be
  reminded to use `fasterq-dump --split-3` to split R1/R2.
- **Verified, parallel downloads.** Files download concurrently with progress bars; read downloads
  are checked against their size and MD5.

Downloaded files default to `./<accession>/`; override with `-o <dir>`.

### Metadata enrichment & normalization

Two additional flags work with LLM-derived sample metadata:

```bash
# Fetch precomputed, LLM-enriched sample metadata from seqout.org
seqoutdb --enriched GSE12345

# Normalize a project's samples locally with a model (Ollama / llama.cpp / LM Studio)
seqoutdb --norm GSE12345 --model ollama/hf.co/saketlab/seqoutlm-1B-GGUF
```

`--norm` streams normalized labels into a live table. It auto-detects a running local model server,
or starts one for you; use `--port` or `--base-url` to point at a specific server. See
`seqoutdb --help` for the full set of options.

---

## Python API

The library mirrors the CLI and returns fully typed Pydantic models. The entry point is the
`Seqout` client, usable as a context manager.

```python
from seqoutdb import Seqout, SearchParams

with Seqout() as sq:
    # Search
    results = sq.search(SearchParams(q="lung cancer", db="geo", sortby="citations"))
    for r in results.top_cited(5):
        print(r.accession, r.citation_count, r.title)

    # Project metadata and its samples
    meta = sq.fetch_project_metadata("GSE149312")
    samples = sq.fetch_samples("GSE149312")

    # Sample detail
    sample = sq.fetch_sample_detailed_metadata("SRX11169657")
```

### Searching

```python
from seqoutdb import Seqout, SearchParams

with Seqout() as sq:
    params = SearchParams(q="covid intestine", db="geo", sortby="year", order="desc")

    results = sq.search(params)            # first page → SearchResults
    everything = sq.iter_search(params)    # auto-paginating iterator
    first_100 = list(sq.iter_search(params, limit=100))
```

`SearchResults` is a rich, list-like container with convenience methods:

```python
results.by_organism("Homo sapiens")
results.by_source("geo")
results.top_cited(10)
results.most_recent(10)
results.organisms()      # Counter of organism → frequency
results.sources()        # Counter of source → frequency
results.to_df()          # pandas DataFrame
results.to_csv("out.csv")
```

For field-targeted queries, use `StructuredSearchParams` (organism, platform, library strategy,
country, year range, and more) with `sq.search(...)` / `sq.iter_search(...)`.

### Fetching metadata

| Method | Returns |
| --- | --- |
| `fetch_project_summary(acc)` | `ProjectSummaryResult` |
| `fetch_project_metadata(acc)` | `ProjectMetadataResult` |
| `fetch_samples(acc)` | `ExperimentSampleList` (GEO series / ArrayExpress) |
| `fetch_study_experiments(study)` | `StudyExperimentsResults` (SRA / ENA) |
| `fetch_study_runs(study)` | `StudyRunsResults` |
| `fetch_sample_metadata(sample)` | `SampleMetadataResult` |
| `fetch_sample_detailed_metadata(sample)` | `SampleDetailedMetadata` |
| `fetch_geo_sample_detailed_metadata(sample)` | `GeoSampleDetailedMetadata` |
| `fetch_cross_references(acc)` | `ProjectCrossReferenceList` |
| `fetch_project_enriched_metadata(acc)` | `ProjectLLMEnrichedSampleMetadataResults` |

Bulk variants (`bulk_search`, `bulk_fetch_project_summary`) parallelize requests across a thread pool.

### Downloading data

```python
from pathlib import Path
from seqoutdb import Seqout

with Seqout() as sq:
    # Supplementary files for a project
    meta = sq.fetch_project_metadata("GSE149312")
    sq.download_project_supplementary_data(meta, Path("GSE149312"))

    # Sequencing reads for a study (mode: fastq | sra | sra_lite | s3 | gcs)
    runs = sq.fetch_study_runs("SRP324458")
    sq.download_study_runs_data(runs, Path("SRP324458"), mode="fastq")
```

Both download methods run in parallel and accept `n_workers`, `chunk_size`, and `verbose`. Read
downloads are verified against their reported size and MD5 checksum.

---

## Accession reference

| Kind | Examples | Use with |
| --- | --- | --- |
| GEO series | `GSE149312` | `show`, `download`, search |
| GEO sample | `GSM8241457` | `show`, `download` |
| SRA / ENA study | `SRP324458`, `PRJNA…` | `show`, `download` |
| SRA experiment | `SRX11169657` | `show`, `download` |
| SRA run | `SRR14851096` | `download --fastq` |
| ArrayExpress | `E-GEOD-18544`, `E-MTAB-…` | `show`, `download` |

---

## License

See the repository root for license and contribution details. seqoutDB is a client for
[seqout.org](https://seqout.org); please consult the upstream data sources for their respective
terms of use.
