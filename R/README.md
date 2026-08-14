# seqout <img src="man/figures/logo.svg" align="right" height="120" alt="seqout logo" />

Search genomics study metadata from [seqout.org](https://seqout.org), which indexes
NCBI GEO, NCBI SRA, EBI ENA, DDBJ (DRA and GEA), ArrayExpress and GSA. Resolve an
accession to its records in every archive, and read GEO supplementary files as counts
matrices.

## Installation

```r
pak::pak("saketlab/seqout/R")
```

or from [r-universe](https://saketlab.r-universe.dev/seqout):

```r
install.packages("seqout", repos = "https://saketlab.r-universe.dev")
```

## Usage

```r
library(seqout)

project("GSE151530")
project_samples("GSE151530")
search("liver cancer scRNA", db = "geo")
```

## Two backends

| Backend | How it works | When to use it |
| --- | --- | --- |
| REST API (default) | It calls the seqout.org web API. | Normal use. It is always up to date. |
| Parquet | It reads Parquet data dumps with DuckDB. | Offline or local use, SQL, and large batch jobs. |

The REST API is the default, and it needs no setup: the examples above call no
other function first.

Select the Parquet backend with `seqout_connect()`. Use SQL for a filter or a
count over the full index:

```r
con <- seqout_connect("parquet")

query("
  SELECT dominant_scientific_name AS organism, count(*) AS n
  FROM unified_metadata
  WHERE n_samples >= 10
  GROUP BY organism ORDER BY n DESC LIMIT 10
", con = con)

seqout_default(con) # or make it the default for the session
```

## From a GEO accession to a counts matrix

Supplementary files are grouped into units that read as one matrix: a 10x triplet, a
CellRanger `.h5`, an `.h5ad`, an `.rds` or a table. The manifest resolves them without
downloading anything.

```r
counts <- seqout_counts("GSE297547")
manifest(counts)
m <- seqout_matrix(counts, sample = "GSM8994520")
sample_frame(project_samples("GSE297547"))
```

## Next

- [Getting started](articles/getting-started.html)
- [Counts and metadata](articles/counts-and-metadata.html)
- [Function reference](reference/index.html)
- [Python client](https://seqout.org/cli/python/) for the same data
