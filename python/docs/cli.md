---
description: "Every seqout command and flag: search, show, download, accession conversion, Parquet."
---

# Command line

The `seqout` command has one subcommand for each task as desribed here

To see the help for any subcommand, add `--help`:

```bash
seqout search --help
```

## search

`search` does a full-text search for projects across all seven repositories. This is powered by the same search engine that is used in [seqout.org](https://seqout.org/). The[ _How search works_](https://seqout.org/howsearchworks) page documents the semantics of the search algorithm, including how to perform [structured search](https://seqout.org/howsearchworks#structured-search).

```bash
seqout search "lung cancer single cell"
```

You can search with filters only. In this case, you give no query text:

```bash
seqout search --organism "Homo sapiens" --db geo -d 2020:2023
```

Common options:

| Option | Effect |
| --- | --- |
| `--db` | Limit the search to one source: `geo`, `sra`, `arrayexpress`, `ena`, `gsa`, `dra`, or `gea`. |
| `-O`, `--organism` | Filter by an exact scientific name, such as `"Homo sapiens"`. |
| `-S`, `--strategy` | Filter by library strategy, such as `RNA-Seq` (GEO and SRA only). |
| `-P`, `--platform` | Filter by platform, such as `ILLUMINA` (GEO and SRA only). |
| `-C`, `--source` | Filter by library source, such as `TRANSCRIPTOMIC` (SRA only). |
| `--country` | Filter by the study's country, such as `Japan`. |
| `--journal` | Filter by the linked paper's journal, such as `Nature`. |
| `--instrument` | Filter by instrument, such as `"Illumina NovaSeq 6000"`. |
| `--assay` | Filter by assay method: `RNA-seq`, `ATAC-seq`, `ChIP-seq`, and so on. |
| `--assay-class` | Filter by broad assay class, such as `Transcriptomic`. |
| `--multi-platform` | Keep only studies that used two or more platforms. |
| `--exact` | Read the query as a boolean expression. See below. |
| `-d`, `--date` | Filter by date. Use `2020`, `15-08-2020`, or a range like `2018:2022`. |
| `--sort` | Sort by `citations`, `journal`, or `year`. |
| `-m`, `--max` | Stop after this many results. |
| `-o`, `--saveto` | Write the results to a file. The format comes from the file extension: `.json`, `.tsv`, or `.csv`. |

The filters combine, and each one works with a query or without one:

```bash
seqout search liver --assay ATAC-seq --sort citations -m 10
seqout search liver --country Japan --instrument "Illumina NovaSeq 6000"
```

### Structured search

A query can be a boolean expression. Group terms with `()`, quote a phrase with
`""`, end a term with `*` to match its prefix, and join them with an uppercase
`OR`, `AND` or `NOT`. Quote the whole query so the shell does not read the
parentheses itself:

```bash
seqout search '("aging" OR "aged") (gut OR colon) immun*'
```

A structured search takes your terms exactly, with no ontology expansion and no
spelling correction. The operators select that reading on their own; `--exact`
forces it on a query that has no operators of its own:

```bash
seqout search "liver cancer" --exact
```

On a terminal, the search shows one page of results. Use the left and right
arrow keys to change the page. Push `q` to quit.

## show

`show` displays the samples or the experiments of a project as a table.

```bash
seqout show GSE12345
```

The command finds the type of the accession first. Then it shows the correct
view:

- For a GEO series or an ArrayExpress experiment, it shows the samples.
- For an SRA or ENA study, it shows the experiments.
- For a single run or a single sample, it shows the details of that record.

## download

`download` saves data to your computer. The default output is the metadata as a
JSON file.

```bash
seqout download GSE12345
```

To download data files, add one option:

| Option | What it downloads |
| --- | --- |
| `--fastq` | The run files in FASTQ format. |
| `--sra` | The run files in SRA format. |
| `--sra-lite` | The run files in SRA Lite format. |
| `--s3` | The run files from the AWS S3 mirror. |
| `--gcs` | The run files from the Google Cloud mirror. |
| `--supplementary` | The supplementary files of the project. |
| `--sample-supplementary` | The supplementary files of each sample. |

Set the output location with `-o` or `--out`.

If you give a run accession (for example `SRR13711483`), the command finds its
study first. Then it downloads that run.

On a terminal with no option, the command shows a menu. The menu lists all data
that is available for the accession. You select one item.

## convert

`convert` maps an accession to a related accession. It uses the metadata in
seqout.

There are two ways to convert.

### The generic form

The generic `convert` command works for every source. Give one or more
accessions and a target kind with `--to`:

```bash
seqout convert GSE12345 --to srp
seqout convert SRP123456 SRP123457 --to gsm
```

The target kinds are `study`, `experiment`, `sample`, `run`, and the aliases
`srp`, `srx`, `srs`, `srr`, `gsm`, `gse`, `pmid`, and `doi`.

### The a-to-b form

There is also a short subcommand for each direction, like [pysradb](https://saket-choudhary.me/pysradb/index.html) previously developed in our lab.

```bash
seqout gse-to-srp GSE12345
seqout srr-to-srp SRR13711483
seqout srp-to-gsm SRP123456
```

The client has subcommands for GEO, SRA, ENA (`er*`), DDBJ (`dr*`), and GSA
(`cr*`). It also has literature subcommands, such as `srp-to-pmid`,
`pmid-to-srp`, and `doi-to-gse`.

To save the result to a file, add `-o` or `--saveto`.

## pmid

`pmid` lists every dataset that is linked to a publication. Give a PubMed ID or
a DOI:

```bash
seqout pmid 34764296
seqout pmid 10.1038/ng.2214
```

## author

`author` lists every dataset that is linked to an author:

```bash
seqout author "Aviv Regev"
```

The command also shows the institutes of the author.

## The `--parquet` option

The subcommands `show`, `download`, `pmid`, `author`, and all `convert`
commands accept the `--parquet` option. The command then reads Parquet data
with DuckDB and sends no request to the API.

```bash
# use the configured or default Parquet source
seqout gse-to-srp GSE12345 --parquet

# use a specific local directory for this command
seqout show SRP123456 --parquet /data/seqout

# use a specific URL for this command
seqout pmid 34764296 --parquet https://seqout.org/data
```

For more information about Parquet sources, see
[Parquet backend](parquet.md).

## parquet

The `parquet` subcommand manages the Parquet data dump. It has four commands:
`download`, `query`, `show`, and `set-source`. See
[Parquet backend](parquet.md).

## Normalize sample metadata

The `--norm` top-level option turns a project's raw sample metadata into
structured labels with a local model. See
[Metadata normalization](normalization.md).
