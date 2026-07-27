# Python library

You can use `seqout` in your own Python code. The library does the same tasks
as the command-line tool.

## Connect to a backend

The `connect_to_seqout` function returns a client. Choose the backend with the
`backend` argument:

```python
from seqout import connect_to_seqout

sq = connect_to_seqout(backend="api")       # the web API (default)
pq = connect_to_seqout(backend="parquet")   # Parquet data with DuckDB
```

The client is a context manager. Use a `with` block to close it correctly:

```python
from seqout import connect_to_seqout, SearchParams

with connect_to_seqout(backend="api") as sq:
    results = sq.search(SearchParams(q="lung cancer", db="geo"))
```

## Search

Give the search parameters in a `SearchParams` object:

```python
from seqout import connect_to_seqout, SearchParams

with connect_to_seqout(backend="api") as sq:
    params = SearchParams(
        q="lung cancer",
        db="geo",
        organism="Homo sapiens",
    )
    results = sq.search(params)          # one page of results
    for r in results:
        print(r.accession, r.title, r.citation_count)
```

To read every result across all pages, use `iter_search`:

```python
with connect_to_seqout(backend="api") as sq:
    for r in sq.iter_search(params):
        print(r.accession)
```

## Get a project, its samples, and its runs

```python
with connect_to_seqout(backend="api") as sq:
    meta = sq.fetch_project_metadata("GSE12345")
    samples = sq.fetch_samples("GSE12345")               # GEO or ArrayExpress
    experiments = sq.fetch_study_experiments("SRP123456")
    runs = sq.fetch_study_runs("SRP123456", full=True)   # every run
```

!!! note
    The `full=True` argument returns every run. Without it, the API returns a
    preview of the first 500 runs.

## Convert accessions and find publications

```python
with connect_to_seqout(backend="api") as sq:
    study = sq.resolve_study("SRR13711483")     # a run -> its study
    pub = sq.find_publication(pmid="34764296")  # a publication -> its projects
    authored = sq.search_author_projects("Aviv Regev")
```

## Use the Parquet backend

The Parquet backend has the same methods. Set the data source first:

```python
with connect_to_seqout(backend="parquet") as pq:
    pq.set_source("https://seqout.org/data")   # a URL or a local directory
    study = pq.fetch_study("GSE169470")
    runs = pq.fetch_study_runs("SRP311850")
    pub = pq.find_publication(pmid="22406642")
```

Because both clients share the same method names and the same return models,
you can change the backend without a change to the rest of your code.

!!! warning "Parquet limits"
    The Parquet backend reads the whole data file for a filter. Over a remote
    URL, this is slow for the large tables. A local directory is much faster.
    Also, `search_author_projects` on Parquet matches GEO authors only.

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

`connect_to_seqout` is the normal way to get a client. To import a client class
directly, use the full path:

```python
from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
```
