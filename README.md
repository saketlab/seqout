# seqout

Clients for [seqout.org](https://seqout.org), which aggregates study metadata from
GEO, SRA, ENA, DDBJ, ArrayExpress, GEA and GSA. 

Seqout client can be used search across all the databases, resolve
an accession to its records in every archive, and read GEO supplementary files as
counts matrices.

## Python

`uv add seqout` | [seqout.org/cli/python](https://seqout.org/cli/python/)

```python
from seqout import connect

sq = connect()
sq.search("liver cancer scRNA", organism="Homo sapiens")
sq.get("GSE151530").samples
```

The package also installs a `seqout` command:

```bash
seqout search "liver cancer scRNA" --organism "Homo sapiens"
seqout show GSE151530
```

`seqout` can also be installed system-wide as a CLI tool:

```bash
uv tool install seqout
```

## R

`pak::pak("saketlab/seqout/R")` or [r-universe](https://saketlab.r-universe.dev/seqout) |
[seqout.org/cli/R](https://seqout.org/cli/R/)

```r
library(seqout)

# No connection needed; every function reads the REST API by default
project("GSE151530")
project_samples("GSE151530")

seqout_search("liver cancer scRNA", organism = "Homo sapiens")

# Opt in to Parquet for SQL over the whole index
con <- seqout_connect("parquet")
query("SELECT count(*) FROM unified_metadata WHERE n_samples >= 10", con = con)
```

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

