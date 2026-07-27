# Command-line examples

Concrete commands for common tasks. Add `--help` to any command for its full
options.

## Search

```bash
# free-text search
seqoutdb search "lung cancer single cell"

# filters only, no query text
seqoutdb search --organism "Homo sapiens" --db geo -d 2020:2023

# narrow, then save to a file
seqoutdb search "atac-seq" --db sra -S ATAC-seq -P ILLUMINA -m 50 -o hits.csv
```

## Inspect a project

```bash
seqoutdb show GSE12345     # GEO series -> its samples
seqoutdb show SRP123456    # SRA study  -> its experiments
```

## Download

```bash
seqoutdb download GSE12345                    # metadata as JSON
seqoutdb download SRP123456 --fastq -o ./fq   # run files, FASTQ
seqoutdb download GSE12345 --supplementary    # project supplementary files
seqoutdb download SRR13711483 --sra-lite      # one run, resolved to its study
```

With no option on a terminal, `download` shows a menu of what is available.

## Convert accessions

```bash
seqoutdb gse-to-srp GSE12345         # a GEO series -> its SRA study
seqoutdb srr-to-srp SRR13711483      # a run        -> its study
seqoutdb convert SRP123456 --to gsm  # generic form, any source
seqoutdb srp-to-pmid SRP123456       # a study      -> its publication
```

## Publications and authors

```bash
seqoutdb pmid 34764296
seqoutdb pmid 10.1038/ng.2214
seqoutdb author "Aviv Regev"
```

## Normalize sample metadata

```bash
seqoutdb --norm GSE12345
```

See [Metadata normalization](../normalization.md) for the model options.

## Parquet backend (offline)

```bash
# query the public data with SQL, no download
seqoutdb parquet query "SELECT COUNT(*) AS n FROM geo_series"

# download the files for fast local use
seqoutdb parquet download /data/seqout

# run any command against Parquet instead of the API
seqoutdb show GSE12345 --parquet
seqoutdb gse-to-srp GSE12345 --parquet /data/seqout
```

See [Parquet backend](../parquet.md) for the data sources.
