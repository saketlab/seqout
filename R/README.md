# seqout

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

con <- seqout_connect()
find_projects(con, keywords = "liver cancer scRNA", organism = "Homo sapiens")
project_samples(con, "GSE151530")
```

Queries are answered either from the REST API or from remote Parquet files through
DuckDB, with no download step.

## From a GEO accession to a counts matrix

Supplementary files are grouped into units that read as one matrix: a 10x triplet, a
CellRanger `.h5`, an `.h5ad`, an `.rds` or a table. The manifest resolves them without
downloading anything.

```r
counts <- seqout_counts(con, "GSE297547")
manifest(counts)
m <- seqout_matrix(counts, sample = "GSM8994520")
sample_frame(project_samples(con, "GSE297547"))
```

## Next

- [Getting started](articles/getting-started.html)
- [Counts and metadata](articles/counts-and-metadata.html)
- [Function reference](reference/index.html)
- [Python client](https://seqout.org/cli/python/) for the same data
