# seqout

Clients for [seqout.org](https://seqout.org), which aggregates study metadata from
GEO, SRA, ENA, DDBJ, ArrayExpress, GEA and GSA. Search across all of them, resolve
an accession to its records in every archive, and read GEO supplementary files as
counts matrices.

## Python

`uv add seqout` | [seqout.org/cli/python](https://seqout.org/cli/python/) 

## R

`pak::pak("saketlab/seqout/R")` | [seqout.org/cli/R](https://seqout.org/cli/R/) |


## Python

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

## R

```r
library(seqout)

con <- seqout_connect()
find_projects(con, keywords = "liver cancer scRNA", organism = "Homo sapiens")
project_samples(con, "GSE151530")
```

## From a GEO accession to a single-cell matrix

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
counts <- seqout_counts(con, "GSE297547")
manifest(counts)
m <- seqout_matrix(counts, sample = "GSM8994520")
sample_frame(project_samples(con, "GSE297547"))
```

