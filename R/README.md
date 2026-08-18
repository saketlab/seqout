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

SeqoutSearch("liver cancer scRNA", db = "geo")

d <- SeqoutGet("GSE151530")
d$meta$title
d$samples
d$pubs
```

`SeqoutGet()` takes any accession and resolves the rest itself. Each field
makes its request the first time you read it, and it keeps the answer.

## Two backends

| Backend | How it works | When to use it |
| --- | --- | --- |
| REST API (default) | It calls the seqout.org web API. | Normal use. It is always up to date. |
| Parquet | It reads Parquet data dumps with DuckDB. | Offline or local use, SQL, and large batch jobs. |

The REST API is the default, and it needs no setup: the examples above call no
other function first.

Select the Parquet backend with `SeqoutConnect()`. Use SQL for a filter or a
count over the full index:

```r
con <- SeqoutConnect("parquet")

Query("
  SELECT dominant_scientific_name AS organism, count(*) AS n
  FROM unified_metadata
  WHERE n_samples >= 10
  GROUP BY organism ORDER BY n DESC LIMIT 10
", con = con)

SeqoutDefault(con) # or make it the default for the session
```

## From a GEO accession to a counts matrix

Supplementary files are grouped into units that read as one matrix: a 10x triplet, a
CellRanger `.h5`, an `.h5ad`, an `.rds` or a table. `SeqoutCounts()` lists them without
downloading anything.

```r
counts <- SeqoutCounts("GSE297547")
counts
m <- SeqoutMatrix(counts, sample = "GSM8994520")
```

## Downloads

```r
DownloadSupplementary("GSE168652") # the processed files
DownloadRuns("SRR12012336")        # the reads
DownloadBams("ERP117016")          # the submitted alignments
```

## Next

- [Getting started](articles/getting-started.html)
- [Search](articles/search.html)
- [Metadata](articles/metadata.html)
- [Counts](articles/counts.html)
- [Downloads](articles/downloads.html)
- [Function reference](reference/index.html)
- [Python client](https://seqout.org/cli/python/) for the same data
