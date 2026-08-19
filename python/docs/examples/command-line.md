---
description: "Common CLI commands for query searching, metadata inspection, downloads, accession mapping, and offline Parquet queries."
---

# Command-Line Examples

This page provides command examples for common data discovery and retrieval tasks using the `seqout` CLI. To view the complete list of options for any command, append the `--help` flag.

## Search the database

```bash
# Perform a full-text search for lung cancer single-cell datasets
seqout search "lung cancer single cell"

# Filter by organism and database range without query text
seqout search --organism "Homo sapiens" --db geo -d 2020:2023

# Filter by assay type and platform, cap results, and save to a CSV file
seqout search "atac-seq" --db sra -S ATAC-seq -P ILLUMINA -m 50 -o hits.csv
```

## Inspect study metadata

```bash
# View sample metadata for a GEO series
seqout show GSE12345

# View experiment metadata for an SRA study
seqout show SRP123456
```

## Download files

```bash
# Download study metadata as a JSON file
seqout download GSE12345

# Download raw reads in FASTQ format to a target directory
seqout download SRP123456 --fastq -o ./fq

# Download processed study-level supplementary files
seqout download GSE12345 --supplementary

# Download a specific run in SRA Lite format (resolves parent study automatically)
seqout download SRR13711483 --sra-lite
```

If you run `download` in a terminal without option arguments, the CLI displays an interactive resource menu.

## Map accessions

```bash
# Map a GEO series accession to its corresponding SRA study accession
seqout gse-to-srp GSE12345

# Map a run accession to its SRA study accession
seqout srr-to-srp SRR13711483

# Map an SRA study to GEO sample accessions using the generic converter
seqout convert SRP123456 --to gsm

# Map an SRA study accession to its PMID citation
seqout srp-to-pmid SRP123456
```

## Search by publication and author

```bash
# Find datasets associated with a PMID
seqout pmid 34764296

# Find datasets associated with a DOI
seqout pmid 10.1038/ng.2214

# Find datasets associated with a specific researcher
seqout author "Aviv Regev"
```

## Query the Parquet backend offline

```bash
# Run SQL queries against remote Parquet files without downloading them
seqout parquet query "SELECT COUNT(*) AS n FROM geo_series"

# Download the database Parquet tables to a local directory
seqout parquet download /data/seqout

# Run standard CLI commands offline using the downloaded Parquet data source
seqout show GSE12345 --parquet
seqout gse-to-srp GSE12345 --parquet /data/seqout
```

For data source configuration options, see [Parquet Backend](../parquet.md).
