# seqout

A Python client and command-line tool for [seqout.org](https://seqout.org) — search and explore
genomic study metadata from **GEO**, **SRA**, **ArrayExpress**, and **ENA**, and download both
metadata and raw data files from a single, consistent interface.

It comes in two parts that share the same engine:

- **`seqout`** — a friendly command-line tool for everyday lookups and downloads.
- **`seqout` (the library)** — a typed Python API for use in scripts, notebooks, and pipelines.

---

## Installation

All you need is [uv](https://docs.astral.sh/uv/).

**As a command-line tool** — install it globally with `uv tool`:

```bash
uv tool install seqout
seqout --help
```

This puts `seqout` on your PATH, isolated from your projects. Upgrade with
`uv tool upgrade seqout`. You can also run it without installing via `uvx seqout …`.

**As a library** in your own project:

```bash
uv add seqout
```

**From source** (for development):

```bash
git clone https://github.com/saketlab/seqout.git
cd seqout/python
uv sync
uv run seqout --help
```

From a source checkout, anything shown below as `seqout …` can be run as `uv run seqout …`.

Requires Python 3.13 or newer.

---

## Command-line tool

The CLI is organized around a few clear verbs. Run `seqout --help` (or `seqout <command> --help`)
at any time.

| Command | Purpose |
| --- | --- |
| `seqout search <query>` | Full-text search across all sources |
| `seqout show <accession>` | Inspect a project (table) or a sample (detail view) |
| `seqout download <accession>` | Download metadata, supplementary files, or sequencing reads |

### Search

```bash
# Search everything
seqout search "lung cancer single cell"

# Narrow to one source, sort by citations, cap the results
seqout search "covid intestine" --db geo --sort citations -n 5
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
seqout show GSE149312
seqout show SRP324458
seqout show E-GEOD-18544

# A sample → a detailed field-by-field view, including its characteristics/attributes
seqout show GSM8241457
seqout show SRX11169657
```

### Download

By default `download` saves **metadata** as JSON. Flags switch it to downloading **files**.

```bash
# Metadata → ./GSE149312.json   (project + all of its samples)
seqout download GSE149312

# Sample metadata → ./GSM8241457.json
seqout download GSM8241457

# Choose the destination (file or directory)
seqout download SRP324458 -o ./study/
```

**Supplementary files** (processed data, matrices, archives):

```bash
seqout download GSE149312 --supplementary
```

**Sequencing reads** (`--fastq`, plus `--sra`, `--sra-lite`, `--s3`, `--gcs`):

```bash
# Every run in a study
seqout download SRP324458 --fastq

# A single run — pick exactly which files to download, interactively
seqout download SRR14851096 --fastq
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

### Enriched metadata (`--enriched`)

Fetch precomputed, LLM-enriched sample metadata that seqout.org has already prepared for a project:

```bash
seqout --enriched GSE12345
```

This is a simple online lookup — no local model required.

### Normalizing sample metadata locally (`--norm`)

`--norm` takes the messy, free-text metadata of a project's samples and turns it into clean,
structured labels using a language model that runs **entirely on your own machine**. Nothing about
your query leaves your computer except the original metadata fetch from seqout.org.

```bash
seqout --norm GSE149312
```

For every sample it extracts these 16 fields:

```
organism             tissue                tissue_primary_site   tissue_site_type
cell_type            cell_line             disease               phenotype
strain               ethnicity             development_stage     treatment
genetic_modification assay                 assay_category        sample_type
```

Results stream into a live table as each sample finishes (a single sample is shown as a vertical
field/value view instead). Works with project accessions (`GSE…`, `SRP…`, `E-…`) and individual
samples (`GSM…`, `SRS…`, `SRX…`).

#### Prerequisites

You need **one** local inference engine installed and able to serve GGUF models:

- **[Ollama](https://ollama.com)** — default port `11434`
- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** (`llama-server`) — default port `8080`
- **[LM Studio](https://lmstudio.ai)** — default port `1234`

If none are installed, `seqout` tells you what's missing rather than failing cryptically.

#### How the model is chosen

`seqout` resolves the model in this order:

1. **`--base-url`** — if given, it talks to that already-running OpenAI-compatible server and never
   starts anything itself.
2. **A running server** — otherwise it auto-detects a local engine already listening (on `--port`
   if you gave one, else the engines' default ports) and uses the model it is already serving.
3. **`--model`** — if nothing is running, it starts an engine using your `--model` spec.
4. **The default model** — if you didn't pass `--model`, it falls back to the bundled
   `saketlab/seqoutlm-1B-GGUF`, a model fine-tuned for exactly this task.

When it has to start a server and download a model, that happens automatically on first use.

#### Choosing a model with `--model`

`--model` is written as `engine/model`:

```bash
# Ollama with the default seqoutlm model (pulled from Hugging Face on first run)
seqout --norm GSE149312 --model ollama/hf.co/saketlab/seqoutlm-1B-GGUF

# Ollama with any model you already have
seqout --norm GSE149312 --model ollama/llama3

# llama.cpp or LM Studio — here the model is a Hugging Face GGUF repo
seqout --norm GSE149312 --model llamacpp/saketlab/seqoutlm-1B-GGUF
seqout --norm GSE149312 --model lmstudio/saketlab/seqoutlm-1B-GGUF
```

A bare engine name (`--model ollama`) uses that engine with the default model. If you omit the
engine prefix entirely, Ollama is assumed.

#### Pointing at a specific server

```bash
# Use whatever model is already loaded on a given port
seqout --norm GSE149312 --port 8080

# Talk to an already-running OpenAI-compatible server directly (never starts one)
seqout --norm GSE149312 --base-url http://localhost:8080/v1
```

This is the simplest path if you already run your own server, e.g.:

```bash
llama-server -hf saketlab/seqoutlm-1B-GGUF --port 8080 --jinja
seqout --norm GSE149312 --base-url http://localhost:8080/v1
```

#### Gated or private models

The default `saketlab/seqoutlm-1B-GGUF` repo may be gated on Hugging Face. If a download is needed
and the repo is private, `seqout` prompts you for an access token
([create one here](https://huggingface.co/settings/tokens)). You can also set it in the environment
to skip the prompt:

```bash
export HF_TOKEN=hf_xxxxxxxx   # or HUGGING_FACE_HUB_TOKEN / HUGGINGFACE_TOKEN
```

No token is needed when the model is public, already downloaded, or already being served.

Run `seqout --help` for the complete list of options.

---

## Python API

The library mirrors the CLI and returns fully typed Pydantic models. The entry point is
`connect()`, usable as a context manager.

```python
from seqout import connect

with connect() as sq:
    # Search
    for r in sq.search("lung cancer", db="geo", sortby="citations").top_cited(5):
        print(r.accession, r.citation_count, r.title)

    # Open a dataset — any accession: series, study, experiment, sample, or run
    d = sq.get("GSE149312")
    d.meta          # project metadata
    d.samples       # GEO samples here, SRA experiments in an SRA study
    d.runs          # every run, via the linked SRA study
    d.pubs          # publications
    d.links         # the same data in other archives
    d.enriched      # LLM-enriched per-sample metadata
```

`Dataset` fetches each field on first use and keeps the result. It crosses the GEO/SRA
boundary on its own, so `sq.get("GSE149312").runs` and `sq.get("SRP324458").runs` both work.
`d.project`, `d.geo`, and `d.sra` expose the accessions it resolved.

### Searching

```python
from seqout import connect, SearchParams

with connect() as sq:
    results = sq.search("covid intestine", db="geo", sortby="year")

    # a SearchParams object holds the same fields, for reuse across calls
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

`sq.get(acc)` covers most of this. The short top-level calls:

| Method | Returns |
| --- | --- |
| `get(acc)` | `Dataset` — any accession, resolves the rest |
| `paper(pmid=…, doi=…)` | `PublicationLookupResult` — a paper → its projects |
| `author(name)` | `AuthorProjectsResponse` |
| `classify(acc)` | `AccessionClassification` |
| `summaries([acc, …])` | `ProjectSummaryResultList` — many projects, one request |

The per-endpoint methods `get` is built on, for when you want one specific request:

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
from seqout import connect

with connect() as sq:
    d = sq.get("GSE149312")

    # Supplementary files for a project
    sq.download_project_supplementary_data(d.meta, Path("GSE149312"))

    # Sequencing reads (mode: fastq | sra | sra_lite | s3 | gcs)
    sq.download_study_runs_data(d.runs, Path("SRP324458"), mode="fastq")
```

Both download methods run in parallel and accept `num_workers`, `chunk_size`, and `verbose`. Read
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

See the repository root for license and contribution details. seqout is a client for
[seqout.org](https://seqout.org); please consult the upstream data sources for their respective
terms of use.
