---
description: Dataset access by accession, filtered search, and downloads of reads and supplementary files from Python.
---

# Python library

You can use `seqout` in your own Python code. The library does the same tasks
as the command-line tool.

## Connect to a backend

The `connect` function returns a client. Choose the backend with the `backend`
argument:

```python
from seqout import connect

sq = connect()                    # the web API (default)
pq = connect(backend="parquet")   # Parquet data with DuckDB
```

The client is a context manager. Use a `with` block to close it correctly:

```python
from seqout import connect

with connect() as sq:
    results = sq.search("lung cancer", db="geo")
```

!!! note
    `connect_to_seqout` is the same function with a longer name. Both work.

## Get a dataset

`get` accepts any accession from any archive seqout holds: a series, a study,
an experiment, a sample, a run, or a BioSample. The `Dataset` finds the related
records for you:

```python
with connect() as sq:
    d = sq.get("GSE168652")

    d.meta          # project metadata
    d.samples       # the per-sample records
    d.experiments   # the library preparations
    d.runs          # every run
    d.pubs          # publications
    d.links         # the same data in other archives
    d.enriched      # LLM-enriched sample metadata
```

Each field makes its request at the first use and keeps the result, so reading
one twice costs a single request. Where a field lives in a different archive
than the accession you gave, the link is followed for you: `d.runs` above reads
`SRP310139`, the SRA study the series links to. An SRA study that lists no
samples reads them from the linked GEO series in the same way.

The archive accessions stay available:

```python
d.kind      # series, study, experiment, sample, run, biosample, or submission
d.project   # the study or series this accession belongs to
d.sra       # the study that holds the runs
d.geo       # the series that holds the supplementary files
```

For a run, a sample, or an experiment accession, `detail` gives the record
itself:

```python
sq.get("SRR13927092").detail    # the run
sq.get("GSM5155196").detail     # the sample
sq.get("GSM5155196").project    # -> "GSE168652"
```

### Accessions across the archives

seqout holds records from GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, and GSA. Each
uses its own accession prefixes. `get` accepts any of them and resolves the
study or series they belong to:

| you have | `kind` | `project` |
|---|---|---|
| `GSE168652`, `GSM5155196` | series, sample | `GSE168652` |
| `SRP310139`, `SRX10306523`, `SRS8447424`, `SRR13927092` | study, experiment, sample, run | the SRA study |
| `PRJNA1458007`, `SAMEA7015536` | study, biosample | the ENA study |
| `DRP016022`, `DRX817961`, `DRR839815` | study, experiment, run | the DDBJ study |
| `CRA002740`, `CRX117570`, `CRR143507`, `HRA000925` | study, experiment, run | the GSA study |
| `E-MTAB-16863`, `E-GEAD-657` | series | itself |

A series holds no sequencing runs of its own; they belong to a study in a
sequence archive. `runs` follows that link. GEO and ArrayExpress record it as a
cross-reference. GEA records no cross-reference, and names the data as a
BioProject in the project record, so that is used when no cross-reference
exists.

`runs` is empty when the dataset has none. A microarray submission such as
`E-TABM-937` has 724 samples and no sequencing data.

### When it cannot work

Some accessions have no path back to their study: the archive serves no parent
and the accession is not in the search index. `project`, and anything that needs
it, raises `SeqoutError` saying so:

```python
sq.get("SAMD01591578").project
# SeqoutError: could not find the study that SAMD01591578 (a biosample)
# belongs to. Nothing links it back: the archive serves no parent for this
# accession and it is not in the search index. Start from the study or series
# accession instead, or call sq.search('SAMD01591578') to look for it.
```

An accession the library does not recognize fails at `get`, before any request.

## Search

`search` accepts a query string with keyword filters:

```python
with connect() as sq:
    results = sq.search("lung cancer", db="geo", organism="Homo sapiens")
    for r in results:
        print(r.accession, r.title, r.citation_count)
```

A `SearchParams` object does the same and is easier to build in steps:

```python
from seqout import SearchParams

params = SearchParams(q="lung cancer", db="geo", organism="Homo sapiens")
results = sq.search(params)
```

To read every result across all pages, use `iter_search`:

```python
with connect() as sq:
    for r in sq.iter_search("lung cancer", db="geo"):
        print(r.accession)
```

## Find publications and authors

```python
with connect() as sq:
    pub = sq.paper(pmid="34764296")               # a publication -> its projects
    authored = sq.author("Aviv Regev")            # an author -> their datasets
    kind = sq.classify("GSE168652")               # what an accession is
    rows = sq.summaries(["GSE168652", "GSE100379"])  # many projects, one request
```

## The lower-level methods

`get` calls these. Use them when you want one specific request. Each is tied to
one endpoint, so you have to give it an accession that endpoint accepts:

```python
with connect() as sq:
    meta = sq.fetch_project_metadata("GSE12345")
    samples = sq.fetch_samples("GSE12345")               # GEO, AE, GEA only
    experiments = sq.fetch_study_experiments("SRP123456")
    runs = sq.fetch_study_runs("SRP123456", full=True)   # every run
    exp_runs = sq.fetch_experiment_runs("SRX10306523")   # the runs of one experiment
    study = sq.resolve_study("SRR13711483")              # a run -> its study
```

!!! note
    The `full=True` argument returns every run. Without it, the API returns a
    preview of the first 500 runs. `Dataset.runs` always uses `full=True`.

`resolve_study` asks the endpoint that knows, chosen by what the accession
names: `/run/{acc}` for a run, `/sample-detail/{acc}` for a sample, an
experiment's first run for the rest. Full-text search is the last resort, since
not every accession is indexed. `Dataset.project` wraps it and raises with the
detail when nothing answers.

## Use the Parquet backend

The Parquet backend has the same methods. Set the data source first:

```python
with connect(backend="parquet") as pq:
    pq.set_source("https://seqout.org/data")   # a URL or a local directory
    d = pq.get("GSE169470")
    runs = d.runs
    pub = pq.paper(pmid="22406642")
```

Because both clients share the same method names and the same return models,
you can change the backend without a change to the rest of your code.

!!! warning "Parquet limits"
    The Parquet backend reads the whole data file for a filter. Over a remote
    URL, this is slow for the large tables. A local directory is much faster.
    Also, `author` on Parquet matches GEO authors only, and `links`, `enriched`,
    `classify`, and `summaries` are not available there.

## Return types

The methods return Pydantic models. A list of records is a `BaseContainer`. A
container has helper methods for data work:

```python
runs = sq.fetch_study_runs("SRP123456", full=True)

runs.to_dict()          # a list of dictionaries
runs.to_df()            # a pandas DataFrame
runs.to_csv("runs.csv") # write a CSV file
len(runs)               # the number of records
```

## Import the client classes directly

`connect` is the normal way to get a client. To import a client class directly,
use the full path:

```python
from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
```
