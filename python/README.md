# seqout

A Python client and command-line tool for [seqout.org](https://seqout.org). Search genomic study
metadata from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA, and download metadata, supplementary
files, sequencing reads, and counts matrices through one interface.

Requires Python 3.13 or newer.

## Installation

```bash
uv tool install seqout          # command-line tool, on your PATH
uv add seqout                   # library, in your project
uv add 'seqout[counts]'         # library, with counts-matrix reading
```

`uvx seqout <command>` runs the tool without installing it. From a source checkout, prefix any command
below with `uv run`.

The development version installs from GitHub. The package lives in the `python/` subdirectory of the
repo, so `#subdirectory=python` is required.

```bash
uv add "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
uv add "seqout[counts] @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
uv tool install "seqout @ git+https://github.com/saketlab/seqout.git#subdirectory=python"
```

## Quick start

```bash
seqout search "lung cancer single cell" --db geo --sort citations -m 5
seqout show GSE149312
seqout download GSE149312 --supplementary
```

```python
from seqout import connect

with connect() as sq:
    d = sq.get("GSE149312")
    print(d.meta.title, len(d.samples), "samples,", len(d.runs), "runs")
```

`Dataset` fetches each field on first use and keeps the result. It crosses the GEO/SRA boundary on
its own, so `sq.get("GSE149312").runs` and `sq.get("SRP324458").runs` both work. An accession with
no path back to its study raises `SeqoutError` naming the lookups that were tried.

### From a GEO accession to a single-cell matrix

Supplementary files are grouped into units that read as one matrix: a 10x triplet, a CellRanger
`.h5`, an `.h5ad`, an `.rds` or a table. The manifest resolves them without downloading anything,
and the donor covariates come from the same accession. Needs the `counts` extra.

```python
from seqout import seqout_counts

counts = seqout_counts(gse="GSE297547")
counts.manifest()                       # what is readable, still no download
m = counts.matrix(sample="GSM8994520")  # cells by genes, obs carries the annotation
counts.design                           # one row per sample: tissue, age, sex
```

## Command-line reference

Run `seqout --help` or `seqout <command> --help` for the full option list.

### Explore

| Command | Description |
| --- | --- |
| `seqout search [query]` | Full-text search across every source |
| `seqout show <accession>` | A project's samples or experiments as a table, or one sample in detail |
| `seqout pmid <pmid\|doi>` | Every dataset linked to a publication |
| `seqout author <name>` | Every dataset an author is linked to |

`search` options: `--db {geo,sra,arrayexpress,ena,gsa,dra,gea}`, `-O/--organism`, `-S/--strategy`,
`-P/--platform`, `-C/--source`, `-d/--date DATE[:DATE]`, `--sort {citations,journal,year}`,
`-p/--page-size` (default 20), `-m/--max`, `-o/--saveto FILE`. The query text is optional when at
least one filter is given.

### Download

| Command | Description |
| --- | --- |
| `seqout download <accession>` | Project or sample metadata as JSON |
| `seqout download <accession> --supplementary` | The project's supplementary files |
| `seqout download <accession> --sample-supplementary` | Per-sample supplementary files |
| `seqout download <accession> --fastq` | Sequencing reads; also `--sra`, `--sra-lite`, `--s3`, `--gcs` |

Metadata lands in `./<accession>.json` and files in `./<accession>/`; `-o/--out` overrides both.

### Convert accessions

| Command | Description |
| --- | --- |
| `seqout convert <accession>... --to <kind>` | Map to `study`, `experiment`, `sample`, `run`, `srp`, `srx`, `srs`, `srr`, `gsm`, `gse`, `pmid`, or `doi` |
| `seqout gse-to-srp <accession>...` | Shorthand for one specific hop |

The shorthands cover GEO, SRA, ENA, and DDBJ prefixes in both directions, plus publication lookups
(`srp-to-pmid`, `doi-to-gse`, and the rest). `seqout --help` lists them all.

### Sample metadata labels

| Command | Description |
| --- | --- |
| `seqout --enriched <accession>` | Structured labels seqout.org has already prepared |
| `seqout --norm <accession>` | Produce the same labels locally with a language model |

`--norm` runs entirely on your machine and takes `--model engine/model`, `--port`, and
`--base-url`. See [metadata normalization](docs/normalization.md).

### Parquet backend

| Command | Description |
| --- | --- |
| `seqout parquet download <dir>` | Fetch the Parquet dump for local use |
| `seqout parquet query "<sql>"` | Run SQL against the Parquet files with DuckDB |
| `seqout parquet show <accession>` | A study, its samples, or its experiments |
| `seqout parquet set-source <url\|dir>` | Set the default source |

`show`, `download`, `convert`, `pmid`, `author`, and the conversion shorthands all accept
`--parquet [SRC]` to answer from Parquet with no API request.

