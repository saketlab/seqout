<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://seqout.org/logo-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="https://seqout.org/logo-light.webp">
    <img src="./public/logo-light.webp" height="72" alt="Seqout">
  </picture>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/license-BSD--3--Clause-blue" alt="License">
  <img src="https://img.shields.io/github/actions/workflow/status/saketlab/seqout/deploy.yml" alt="Build Status">
  <img src="https://img.shields.io/github/last-commit/saketlab/seqout" alt="Last Commit">
</p>
<p align="center">
  <a href="https://seqout.org/"><img src="https://img.shields.io/badge/seqout.org-276DC3?logo=googlechrome&logoColor=white" alt="seqout.org" height="28" style="border:0;vertical-align:middle"></a>
  <a href="https://seqout.org/cli/R/"><img src="https://img.shields.io/badge/R%20package-276DC3?logo=r&logoColor=white" alt="R package" height="28" style="border:0;vertical-align:middle"></a>
  <a href="https://seqout.org/cli/python/"><img src="https://img.shields.io/badge/Python%20client-276DC3?logo=python&logoColor=white" alt="Python client" height="28" style="border:0;vertical-align:middle"></a>
  <a href="https://seqout.org/cli/"><img src="https://img.shields.io/badge/CLI-276DC3?logo=gnometerminal&logoColor=white" alt="CLI" height="28" style="border:0;vertical-align:middle"></a>
  <a href="https://seqout.org/mcp/"><img src="https://img.shields.io/badge/MCP-276DC3?logo=modelcontextprotocol&logoColor=white" alt="MCP" height="28" style="border:0;vertical-align:middle"></a>
</p>

Clients for [seqout.org](https://seqout.org), which aggregates study metadata from
GEO, SRA, ENA, DDBJ, ArrayExpress, GEA and GSA. 

Seqout client can be used search across all the databases, resolve
an accession to its records in every archive, access harmonised sample metadata and read GEO supplementary files as
counts matrices.

## CLI

Seqout can be used as a standalone CLI tool.

```bash
uv tool install seqout
```

The CLI can be used for searching, inspecting metadata and downloading associated files.

```bash
seqout search "liver cancer scRNA" --organism "Homo sapiens"
seqout show GSE151530
seqout download GSE151530
```
Learn more about the CLI here: https://seqout.org/cli/python/cli/ 

## Python client

Install using uv:

```bash
uv add seqout
```

and use in your scripts:

```python
from seqout import connect

sq = connect()
sq.seqout_search("liver cancer scRNA", organism="Homo sapiens")
sq.seqout_get("GSE151530").samples
```

Learn more here: [seqout.org/cli/python](https://seqout.org/cli/python/)

## R package

Install using `pak`:

```R
pak::pak("saketlab/seqout/R")
```

or via [r-universe](https://saketlab.r-universe.dev/seqout) 

```r
library(seqout)

datset <- SeqoutGet("GSE151530")
samples <- dataset$samples

results <- SeqoutSearch("liver cancer scRNA", organism = "Homo sapiens")

# Opt in to Parquet for SQL over the whole index
con <- seqout_connect("parquet")
query("SELECT count(*) FROM unified_metadata WHERE n_samples >= 10", con = con)
```
Learn more here: [seqout.org/cli/R](https://seqout.org/cli/R/)

## From a GEO accession to a single-cell matrix

Seqout library (both python and R) can be used to directly fetch counts,
cell-level and sample-level metadata at once, i.e., you do not need to leave
your programming environment.

Supplementary files are grouped into units that read as one matrix: a 10x triplet,
a CellRanger `.h5`, an `.h5ad`, an `.rds` or a table. The manifest resolves them
without downloading anything, and the donor covariates come from the same
accession.

```python
from seqout import seqout_counts

counts = seqout_counts(gse="GSE297547")
counts.manifest()                       
m = counts.matrix(sample="GSM8994520")  
counts.design                           
```

```r
counts <- seqout_counts("GSE297547")
manifest(counts)
m <- seqout_matrix(counts, sample = "GSM8994520")
sample_frame(project_samples("GSE297547"))
```

