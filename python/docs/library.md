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

`get` accepts any accession — a series, a study, an experiment, a sample, or a
run. The `Dataset` finds the related records for you:

```python
with connect() as sq:
    d = sq.get("GSE168652")

    d.meta          # project metadata
    d.samples       # GEO samples here, SRA experiments in an SRA study
    d.runs          # every run
    d.pubs          # publications
    d.links         # the same data in other archives
    d.enriched      # LLM-enriched sample metadata
```

Each field makes its request at the first use and keeps the result. A GEO series
holds no runs, so `d.runs` goes to the linked SRA study (`SRP310139` for the
example above) on its own. An SRA study that lists no experiments gets its
samples from the linked GEO series in the same way.

The archive accessions stay available:

```python
d.project   # the study or series this accession belongs to
d.sra       # the study that holds the runs
d.geo       # the series that holds the supplementary files
```

For a run or a sample accession, `detail` gives the record itself:

```python
sq.get("SRR13927155").detail    # the run
sq.get("GSM5163504").detail     # the sample
sq.get("GSM5163504").project    # -> "GSE168739"
```

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

`get` calls these. Use them when you want one specific request:

```python
with connect() as sq:
    meta = sq.fetch_project_metadata("GSE12345")
    samples = sq.fetch_samples("GSE12345")               # GEO or ArrayExpress
    experiments = sq.fetch_study_experiments("SRP123456")
    runs = sq.fetch_study_runs("SRP123456", full=True)   # every run
    study = sq.resolve_study("SRR13711483")              # a run -> its study
```

!!! note
    The `full=True` argument returns every run. Without it, the API returns a
    preview of the first 500 runs. `Dataset.runs` always uses `full=True`.

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
