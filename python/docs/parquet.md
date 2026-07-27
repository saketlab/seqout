# Parquet backend

The Parquet backend reads seqout data from Parquet files. It uses DuckDB. It
does not call the seqout.org API.

Use the Parquet backend for these tasks:

- Work offline, with a local copy of the data.
- Run large batch jobs without load on the API.
- Query the data with your own SQL.

## Where the data comes from

The backend reads a set of Parquet files. The set is called a **source**. A
source is one of two things:

- A **URL**, such as `https://seqout.org/data`. The backend reads the files
  over HTTP. It reads only the parts that it needs.
- A **local directory**, such as `/data/seqout`. The backend reads the files
  from the disk.

seqout hosts a public source at **[https://seqout.org/data](https://seqout.org/data)**.
This is the default source. Open that address to browse and download the Parquet
files directly. Each file is at `https://seqout.org/data/<name>.parquet`, for
example [`geo_series.parquet`](https://seqout.org/data/geo_series.parquet). You
can download them with a browser, with `wget`, or with the
[`parquet download`](#download-the-data-files) command.

You can also host the files yourself. See
[Host your own data](#host-your-own-data).

## How the backend selects the source

The backend selects the source in this order. It uses the first one that it
finds:

1. The `--source` option on the command (or the value after `--parquet`).
2. The `SEQOUT_PARQUET_SOURCE` environment variable.
3. The source that you saved with `parquet set-source`.
4. The default source, `https://seqout.org/data`.

## Set a default source

To save a default source, use `set-source`. Give a URL or a local directory:

```bash
seqout parquet set-source /data/seqout
seqout parquet set-source https://example.org/seqout-data
```

After this command, all Parquet commands use that source. You do not need to
give `--source` each time.

## Download the data files

To get a local copy, use `download`. Give the output directory:

```bash
seqout parquet download /data/seqout
```

To download only some files, use `--files`:

```bash
seqout parquet download /data/seqout --files geo_series geo_samples
```

To show a progress bar, add `--with-pbar`.

!!! warning "The files are large"
    The full set of files is large. One table (`run_download_links`) is more
    than 11 GB. Download only the files that you need.

## Query the data with SQL

To run your own SQL, use `query`. The command replaces each table name with the
correct file automatically:

```bash
seqout parquet query "SELECT COUNT(*) AS n FROM geo_series"
seqout parquet query "SELECT accession, title FROM sra_studies LIMIT 5"
```

Options:

- `--source` — use a specific source for this query.
- `--csv` — print the result as CSV.
- `-n`, `--limit` — the maximum number of rows to show (default: 50).

!!! note "Do not reuse a table name as a column alias"
    The command finds table names by text. Do not use a table name as a column
    alias. For example, `SELECT COUNT(*) AS geo_series FROM geo_series` fails.
    Use a different alias, such as `AS n`.

## Show a project from Parquet

The `parquet show` command shows a study, its samples, or its experiments:

```bash
seqout parquet show GSE12345 --samples
seqout parquet show SRP123456 --experiments
```

## Use Parquet with the normal commands

Most commands accept the `--parquet` option. With this option, the command
reads Parquet data instead of the API:

```bash
seqout show GSE12345 --parquet
seqout gse-to-srp GSE12345 --parquet
seqout pmid 34764296 --parquet /data/seqout
```

The `--parquet` option follows the same source order as above. A value after
`--parquet` sets the source for that command only.

## Host your own data

You can host the Parquet files on any web server. The server must support HTTP
range requests. Most static servers, such as nginx, support them.

To use your own server, give its URL as the source:

```bash
seqout parquet set-source https://my-server.example.org/seqout
```

## Performance

The Parquet backend reads a whole column to apply a filter. The large tables
are not sorted by the common filter keys. Over a remote URL, a query on a large
table is slow.

For fast queries on the large tables, download a local copy first. A query on a
local file is much faster than a query over HTTP.
