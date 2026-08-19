---
description: "Configure and query the seqout Parquet dump offline using DuckDB. Run custom SQL queries and download local tables."
---

# Parquet Backend

The Parquet backend queries `seqout` metadata directly from local or remote Parquet files using DuckDB. This backend does not query the `seqout.org` REST API.

Use the Parquet backend to:
*   Work offline with local copies of the database tables.
*   Execute high-throughput batch queries without API rate limits or network latency.
*   Run custom analytical queries using standard SQL.

## Data sources

The backend reads data from a designated source, which can be:
*   **A remote URL:** (e.g., `https://seqout.org/data`). The backend queries Parquet files over HTTP, downloading only the required byte ranges.
*   **A local directory:** (e.g., `/data/seqout`). The backend reads tables directly from disk, providing the fastest query execution.

The package points to `https://seqout.org/data` by default. You can browse and download individual table files (such as `geo_series.parquet`) directly from this address using your browser, command-line tools like `wget`, or the `parquet download` command.

To host the Parquet dump on your own server, see [Host your own Parquet dump](#host-your-own-parquet-dump).

## Source selection order

The Parquet backend selects the active data source using the following priority order:
1.  The `--source` option passed to the command (or the directory path specified after `--parquet`).
2.  The `SEQOUT_PARQUET_SOURCE` environment variable.
3.  The saved default source path configured using `parquet set-source`.
4.  The public default source: `https://seqout.org/data`.

## Configure a default source

To save a default local directory or remote URL for your Parquet queries, use `set-source`:

```bash
# Set a local directory
seqout parquet set-source /data/seqout

# Set a custom remote URL
seqout parquet set-source https://example.org/seqout-data
```

Once configured, all Parquet commands use this source. You do not need to specify `--source` for every command.

## Download database tables

To query data offline, download the Parquet files to a local directory:

```bash
seqout parquet download /data/seqout
```

To download specific tables rather than the entire database, use the `--files` argument:

```bash
seqout parquet download /data/seqout --files geo_series geo_samples
```

To display download progress indicators, add the `--with-pbar` flag.

> [!WARNING]
> The database dump contains large files. For example, the `run_download_links` table exceeds 11 GB. Download only the specific tables required for your analysis.

## Execute SQL queries

To run analytical SQL queries against your Parquet source, use the `query` command. The CLI automatically maps the SQL table names to their corresponding Parquet files:

```bash
seqout parquet query "SELECT COUNT(*) AS n FROM geo_series"
seqout parquet query "SELECT accession, title FROM sra_studies LIMIT 5"
```

Common query options:
*   `--source`: Specifies a temporary Parquet source for the query.
*   `--csv`: Formats the query output as CSV.
*   `-n`, `--limit`: Sets the maximum number of rows to display (default is 50).

> [!CAUTION]
> The query parser identifies tables by matching table names in the text. Do not reuse table names as column aliases (for example, `SELECT COUNT(*) AS geo_series FROM geo_series` will raise a parser error). Use neutral aliases like `AS n`.

## Query study details offline

To inspect studies, samples, or experiments offline using the Parquet backend, use the `parquet show` command:

```bash
seqout parquet show GSE12345 --samples
seqout parquet show SRP123456 --experiments
```

## Enable Parquet mode in standard commands

Most standard CLI commands support the `--parquet` flag. When you append this flag, the command resolves data using the Parquet backend instead of making REST API requests:

```bash
# Query study samples using the default Parquet source
seqout show GSE12345 --parquet

# Map a GEO accession using a specific local Parquet directory
seqout gse-to-srp GSE12345 --parquet /data/seqout

# Resolve a publication using Parquet
seqout pmid 34764296 --parquet
```

The `--parquet` option follows the standard source selection order. Specifying a path immediately after the flag overrides other source configurations for that single command execution.

## Host your own Parquet dump

You can host the Parquet database dump on any HTTP server that supports range requests (e.g., standard Nginx or Apache configurations, AWS S3, or Google Cloud Storage). 

Once uploaded, point your client to the hosting URL:

```bash
seqout parquet set-source https://my-server.example.org/seqout
```

## Query performance

To execute filters, the Parquet backend scans the target columns. Because database tables are not indexed or pre-sorted by common lookup keys, running queries over remote HTTP connections can be slow.

For complex queries or high-throughput workflows, download the Parquet tables to your local disk first. Querying local files is significantly faster than querying them over HTTP.
