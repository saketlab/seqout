---
description: "Detailed reference for seqout CLI commands: search, metadata inspection, downloads, accession conversion, and Parquet management."
---

# Command-Line Interface

The `seqout` command-line interface (CLI) provides commands to search repositories, inspect metadata, download sequencing reads, map accessions, and run SQL queries against Parquet dumps.

To view the help menu and available options for any command or subcommand, append the `--help` flag:

```bash
seqout --help
seqout search --help
```

---

## search

Use the `search` command to perform full-text searches for studies across all seven genomic repositories. This search uses the same engine that powers [seqout.org](https://seqout.org/). For more details on query semantics, see [How search works](https://seqout.org/howsearchworks).

```bash
seqout search "lung cancer single cell"
```

To search using metadata filters without providing a query string, specify the filters directly:

```bash
seqout search --organism "Homo sapiens" --db geo -d 2020:2023
```

### Search command options

| Option | Description |
| --- | --- |
| `--db` | Limits search to one source: `geo`, `sra`, `arrayexpress`, `ena`, `gsa`, `dra`, or `gea`. |
| `-O`, `--organism` | Filters by exact scientific name (e.g., `"Homo sapiens"`). |
| `-S`, `--strategy` | Filters by library strategy (e.g., `RNA-Seq`). |
| `-P`, `--platform` | Filters by sequencing platform (e.g., `ILLUMINA`). |
| `-C`, `--source` | Filters by library source (e.g., `TRANSCRIPTOMIC`). |
| `--country` | Filters by geographic origin country (e.g., `Japan`). |
| `--journal` | Filters by publishing journal (e.g., `Nature`). |
| `--instrument` | Filters by sequencer instrument model (e.g., `"Illumina NovaSeq 6000"`). |
| `--assay` | Filters by assay method (e.g., `RNA-seq`, `ATAC-seq`, `ChIP-seq`). |
| `--assay-class` | Filters by high-level assay class (e.g., `Transcriptomic`). |
| `--multi-platform` | Filters for studies that used multiple platforms. |
| `--exact` | Forces the query to be interpreted as a boolean expression. |
| `-d`, `--date` | Filters by update date. Accepts year (`2020`), exact date (`15-08-2020`), or range (`2018:2022`). |
| `--sort` | Sorts search results by `citations`, `journal`, or `year`. |
| `-m`, `--max` | Caps the number of results returned. |
| `-p`, `--page-size` | Number of results displayed per page on screen. |
| `-o`, `--saveto` | Writes search results to a file. Mapped by extension to `.json`, `.tsv`, or `.csv`. |

You can combine multiple filters in a single search:

```bash
seqout search "liver" --assay ATAC-seq --sort citations --max 10
seqout search "liver" --country Japan --instrument "Illumina NovaSeq 6000"
```

### Structured search queries

To run structured searches, construct boolean queries using parentheses `()`, exact phrase quotes `""`, suffix wildcards `*`, and uppercase operators `AND`, `OR`, and `NOT`. Quote the entire search string to prevent your shell from interpreting the operators:

```bash
seqout search '("aging" OR "aged") (gut OR colon) immun*'
```

Structured searches match terms exactly without applying synonym expansion or spelling correction. 

To force an exact term match on queries that do not contain explicit boolean operators, add the `--exact` flag:

```bash
seqout search "liver cancer" --exact
```

### Interactive page navigation

In interactive terminal mode, the search results display with a paging header showing the total number of hits:

```
'liver cancer' — page 1/27 · 537 results
```

*   Use the **Left** and **Right** arrow keys to page through results.
*   Press **q** to exit the interactive viewer.

---

## onto

Use the `onto` command to query terms in the ontology graph. Standard searches query concepts rather than literal text. For example, a search for `"masld"` automatically matches studies containing `"nonalcoholic fatty liver disease"` because they map to the same concept node in the ontology graph. The `onto` command displays these mappings and their source identifiers.

```bash
seqout onto liver
```

```
                  liver — 3 synonym(s), 35 child(ren)
┏━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ relation ┃ term                       ┃ identifiers                  ┃
┡━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ term     │ liver                      │ UBERON:0002107, MeSH:D008099 │
│ synonym  │ iecur                      │ UBERON:0002107               │
│ synonym  │ livers                     │ MeSH:D008099                 │
│ child    │ bile ducts, intrahepatic ▸ │ MeSH:D001653                 │
│ child    │ biliary ductule            │ UBERON:0004058               │
└──────────┴────────────────────────────┴──────────────────────────────┘
▸ marks a term that expands further · identifiers are source CURIEs
```

Identifiers are CURIEs from source ontologies (such as UBERON, MeSH, and HGNC). A `▸` indicator marks child nodes that contain further child mappings.

You can query multiple terms in a single call. Terms that are not present in the ontology graph are reported as missing rather than causing a failure:

```bash
seqout onto liver hpv16 "breast cancer"
```

### Ontology command options

| Option | Description |
| --- | --- |
| `--hops` | Maximum search depth for synonym links (values 1 to 4, default is 2). |
| `--no-children` | Skips child node queries. Use this to speed up identifier-only lookups. |
| `-m`, `--max` | Limits the number of synonyms and children displayed per term (default is 25). |

---

## bams

Use the `bams` command to list the submitted BAM alignment files associated with a study. These represent alignments generated by the study authors using their reference genome of choice and often preserve metadata (such as cell barcode tags, methylation marks, or long-read structural markers) that raw reads do not contain.

```bash
seqout bams ERP117016
```

Because submitted alignment files can be very large (often hundreds of gigabytes) and are frequently hosted in requester-pays cloud storage, the command lists the files and indicates whether they are openly readable before initiating a download:

```
                        ERP117016 (1.6 GB) — page 1/103 · 412 files
┏━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━┳━━━━━━━━━┳━━━━━━━━━━┓
┃ run        ┃ experiment ┃ title                  ┃ file                  ┃ type ┃    size ┃ readable ┃
┡━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━╇━━━━━━━━━╇━━━━━━━━━━┩
│ ERR3507860 │ ERX3529074 │ NextSeq 500 sequencing │ S6113.E3.L2.1240k.bam │ bam  │ 27.0 MB │ yes      │
│ ERR3507863 │ ERX3529077 │ NextSeq 500 sequencing │ S6113.E3.L5.1240k.bam │ bam  │ 26.2 MB │ yes      │
└────────────┴────────────┴────────────────────────┴───────────────────────┴──────┴─────────┴──────────┘
← prev · → next · q quit — -o DIR to download
```

The interactive table lists files sorted by size (largest first) and pages using the arrow keys. 

### BAM command options

| Option | Description |
| --- | --- |
| `-o`, `--out` | Downloads openly readable BAM files to the specified directory. |
| `--save-to` | Writes the complete file manifest (including URLs and checksums) to a file. Mapped by extension to `.json`, `.tsv`, or `.csv`. |
| `-m`, `--max` | Sets the number of rows displayed per page on screen (default is 20). |

To export the manifest (including links to requester-pays files) for external download scripting, use `--save-to`:

```bash
seqout bams SRP071083 --save-to bams.csv
# Wrote 276 row(s) to bams.csv (276 requester-pays)
```

If files are stored in requester-pays cloud buckets, the command displays the filenames along with the AWS CLI commands required to download them using your own credentials:

```bash
seqout bams SRP071083
# 276 of 276 file(s) are in requester-pays storage.
# Downloading them bills your own account:
#   aws s3 cp --request-payer requester s3://sra-pub-src-5/SRR3202509/PG29.bam .
```

The CLI verifies downloaded files against MD5 checksums when available. Corrupted files are deleted automatically.

The command accepts any accession format:
```bash
# Query study alignments
seqout bams ERP117016

# Query single experiment alignments
seqout bams ERX3529074

# Query single run alignments
seqout bams ERR3507860
```

---

## show

Use the `show` command to display study-level tables or detailed sample attributes. The command automatically identifies the input accession type and displays the corresponding view:
*   **GEO Series / ArrayExpress accession:** Displays a table of study samples.
*   **SRA / ENA Study accession:** Displays a table of study experiments.
*   **Single Sample or Run accession:** Displays detailed metadata attributes for that specific record.

```bash
seqout show GSE12345
seqout show GSM5155196
```

---

## download

Use the `download` command to save metadata or data files to your local system. Running the command without arguments downloads study metadata as a JSON file:

```bash
seqout download GSE12345
```

### Download options

| Option | Description |
| --- | --- |
| `--fastq` | Downloads raw sequencing reads in FASTQ format. |
| `--sra` | Downloads raw sequencing reads in SRA format. |
| `--sra-lite` | Downloads raw sequencing reads in SRA Lite format (binned quality scores). |
| `--s3` | Downloads reads directly from AWS S3 mirrors. |
| `--gcs` | Downloads reads directly from Google Cloud Storage mirrors. |
| `--supplementary` | Downloads study-level processed supplementary files. |
| `--sample-supplementary` | Downloads per-sample processed supplementary files. |
| `-o`, `--out` | Specifies the output destination directory or file path. |

If you pass a run accession (e.g., `SRR13711483`), the command resolves its parent study and downloads the target run.

When you run `download` interactively in a terminal without option arguments, the CLI displays an interactive menu listing all available resources for the accession, allowing you to select which files to download.

---

## convert

Use the `convert` command to map accessions to related accession types using the database metadata index.

### Generic conversion

Specify one or more accessions and define the target type using `--to`:

```bash
seqout convert GSE12345 --to srp
seqout convert SRP123456 SRP123457 --to gsm
```

Supported target types include `study`, `experiment`, `sample`, `run`, and the aliases `srp`, `srx`, `srs`, `srr`, `gsm`, `gse`, `pmid`, and `doi`.

### Shorthand conversion commands

The CLI provides shorthand commands for common conversion directions:

```bash
seqout gse-to-srp GSE12345
seqout srr-to-srp SRR13711483
seqout srp-to-gsm SRP123456
```

Available subcommands cover mappings between GEO, SRA, ENA (`er*`), DDBJ (`dr*`), GSA (`cr*`), PMIDs, and DOIs. To save mapped accessions to a file, use the `-o` or `--saveto` option.

---

## pmid

Use the `pmid` command to list all datasets linked to a publication. You can specify a PubMed ID or a DOI:

```bash
seqout pmid 34764296
seqout pmid 10.1038/ng.2214
```

---

## author

Use the `author` command to list all datasets linked to a researcher:

```bash
seqout author "Aviv Regev"
```

The output table also lists the author's affiliated institutions.

---

## Enable Parquet mode in standard commands

The `show`, `download`, `pmid`, `author`, and `convert` commands support the `--parquet` flag. When specified, the command executes queries offline using your Parquet database source instead of sending REST API requests:

```bash
# Query the configured Parquet source
seqout gse-to-srp GSE12345 --parquet

# Query using a specific local Parquet directory
seqout show SRP123456 --parquet /data/seqout

# Query using a specific remote Parquet URL
seqout pmid 34764296 --parquet https://seqout.org/data
```

For more details on configuring Parquet sources, see [Parquet Backend](parquet.md).

---

## parquet

Use the `parquet` command to manage local database files and run offline SQL queries. The subcommand supports the following actions:
*   `download`: Downloads the published Parquet files.
*   `query`: Executes custom SQL queries using DuckDB.
*   `show`: Displays study records offline.
*   `set-source`: Saves a default Parquet source path.

For more details, see [Parquet Backend](parquet.md).
