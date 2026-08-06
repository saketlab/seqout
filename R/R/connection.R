#' Connect to the SeqOut database
#'
#' Creates a DuckDB connection with remote Parquet views registered for all
#' SeqOut tables. Uses DuckDB's httpfs extension to query Parquet files hosted
#' on seqout.org without downloading them entirely.
#'
#' Registering a view makes DuckDB read that Parquet file's footer over HTTP,
#' so the wait is one round trip per table and worth reporting.
#'
#' @param base_url Base URL of the SeqOut server. Defaults to
#'   `"https://seqout.org"`.
#' @param read_only If `TRUE`, the DuckDB connection is read-only.
#'   Defaults to `FALSE` so that [cache_table()] can materialise views
#'   locally.
#' @param progress Show a progress bar while the tables are registered.
#'   Defaults to `TRUE` in an interactive session.
#'
#' @return A `seqout_connection` object (list) containing the DuckDB
#'   connection handle and configuration.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' query(con, "SELECT * FROM geo_series LIMIT 5")
#' seqout_close(con)
#' }
seqout_connect <- function(base_url = "https://seqout.org",
                           read_only = FALSE,
                           progress = interactive()) {
  base_url <- sub("/$", "", base_url)
  data_url <- paste0(base_url, "/data")

  drv <- duckdb::duckdb()
  db <- DBI::dbConnect(drv, read_only = read_only)

  for (ext in c("httpfs", "json")) {
    tryCatch(
      DBI::dbExecute(db, paste("LOAD", ext)),
      error = function(e) {
        tryCatch(
          {
            DBI::dbExecute(db, paste("INSTALL", ext))
            DBI::dbExecute(db, paste("LOAD", ext))
          },
          error = function(e2) {
            cli::cli_warn("Could not load DuckDB extension {.val {ext}}: {e2$message}")
          }
        )
      }
    )
  }
  DBI::dbExecute(db, "SET enable_http_metadata_cache = true")
  DBI::dbExecute(db, "SET enable_object_cache = true")

  tables <- .seqout_tables()
  ok <- logical(length(tables))
  if (progress) {
    cli::cli_progress_bar(
      format = "Registering {cli::pb_current}/{cli::pb_total} {.val {tbl}} {cli::pb_bar} {cli::pb_eta}",
      total = length(tables), clear = TRUE
    )
  }
  for (i in seq_along(tables)) {
    tbl <- tables[i]
    if (progress) cli::cli_progress_update()
    url <- paste0(data_url, "/", tbl, ".parquet")
    sql <- sprintf(
      "CREATE OR REPLACE VIEW %s AS SELECT * FROM read_parquet('%s')",
      tbl, url
    )
    ok[i] <- tryCatch(
      {
        DBI::dbExecute(db, sql)
        TRUE
      },
      error = function(e) {
        cli::cli_warn("Could not register view {.val {tbl}}: {e$message}")
        FALSE
      }
    )
  }
  if (progress) cli::cli_progress_done()
  registered <- tables[ok]

  con <- structure(
    list(
      db       = db,
      drv      = drv,
      base_url = base_url,
      api_url  = paste0(base_url, "/api"),
      tables   = registered
    ),
    class = "seqout_connection"
  )

  cli::cli_alert_success(
    "Connected to SeqOut ({.url {base_url}}) \u2014 {length(registered)} table{?s} available"
  )

  con
}

#' Close a SeqOut connection
#'
#' @param con A `seqout_connection` returned by [seqout_connect()].
#'
#' @export
seqout_close <- function(con) {
  .check_connection(con)
  DBI::dbDisconnect(con$db, shutdown = TRUE)
  cli::cli_alert_info("SeqOut connection closed.")
  invisible(NULL)
}

#' @export
close.seqout_connection <- function(con, ...) {
  seqout_close(con)
}

#' @export
print.seqout_connection <- function(x, ...) {
  status <- tryCatch(
    {
      DBI::dbGetQuery(x$db, "SELECT 1")
      "connected"
    },
    error = function(e) "disconnected"
  )

  cli::cli_inform(c(
    "{.cls seqout_connection}",
    " " = "Server:    {.url {x$base_url}}",
    " " = "Status:    {status}",
    " " = "Tables:    {length(x$tables)}"
  ))
  invisible(x)
}

#' Keep in sync with EXPORT_TABLES in pysradb-server/scripts/export_parquet.py
#' and with _ALL_PARQUET_FILES in the Python client.
#' @noRd
.seqout_tables <- function() {
  c(
    "arrayexpress_experiments",
    "arrayexpress_samples",
    "dra_experiments",
    "dra_runs",
    "dra_samples",
    "dra_studies",
    "dra_submissions",
    "ena_experiments",
    "ena_samples",
    "ena_studies",
    "gea_experiments",
    "gea_samples",
    "geo_contributors",
    "geo_platforms",
    "geo_samples",
    "geo_series",
    "gsa_experiments",
    "gsa_projects",
    "gsa_samples",
    "gsa_studies",
    "pubmed_metadata",
    "run_download_links",
    "sra_experiments",
    "sra_runs",
    "sra_samples",
    "sra_studies",
    "sra_submissions",
    "unified_centers",
    "unified_metadata"
  )
}

#' @noRd
.check_connection <- function(con) {
  if (!inherits(con, "seqout_connection")) {
    cli::cli_abort(
      "{.arg con} must be a {.cls seqout_connection} (from {.fn seqout_connect})."
    )
  }
  invisible(con)
}
