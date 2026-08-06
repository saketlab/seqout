#' Connect to the SeqOut database
#'
#' Creates a DuckDB connection with remote Parquet views registered for all
#' SeqOut tables. Uses DuckDB's httpfs extension to query Parquet files hosted
#' on seqout.org without downloading them entirely.
#'
#' Registering a view makes DuckDB read that Parquet file's footer over HTTP, so
#' registering all of them costs a round trip per table. Views are created on
#' first reference instead; [register_tables()] does them all when something
#' needs the catalog populated, such as `dplyr::tbl()`.
#'
#' @param base_url Base URL of the SeqOut server. Defaults to
#'   `"https://seqout.org"`.
#' @param read_only If `TRUE`, the DuckDB connection is read-only.
#'   Defaults to `FALSE` so that [cache_table()] can materialise views
#'   locally.
#' @param eager Register every view up front rather than on first use.
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
                           eager = FALSE) {
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

  con <- structure(
    list(
      db       = db,
      drv      = drv,
      base_url = base_url,
      data_url = data_url,
      api_url  = paste0(base_url, "/api"),
      tables   = .seqout_tables(),
      views    = new.env(parent = emptyenv())
    ),
    class = "seqout_connection"
  )

  if (eager) {
    .register_views(con, con$tables, progress = interactive())
  }

  # nothing has been requested from base_url yet on the lazy path, so this
  # reports what is on offer rather than claiming the server answered
  cli::cli_alert_success(
    "SeqOut ({.url {base_url}}) \u2014 {length(con$tables)} table{?s} available"
  )

  con
}

#' Register the remote Parquet views
#'
#' Views are created on first reference, which keeps [seqout_connect()] quick.
#' Anything that reads the DuckDB catalog directly, such as `dplyr::tbl()`,
#' needs them to exist first.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param tables Which tables to register. Defaults to all of them.
#' @param progress Show a progress bar. Defaults to `TRUE` interactively.
#'
#' @return The names of every registered view, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' register_tables(con, "unified_metadata")
#' dplyr::tbl(con$db, "unified_metadata")
#' }
register_tables <- function(con, tables = NULL, progress = interactive()) {
  .check_connection(con)
  tables <- tables %||% con$tables
  unknown <- setdiff(tables, con$tables)
  if (length(unknown) > 0) {
    cli::cli_abort("Not a SeqOut table: {.val {unknown}}.")
  }
  invisible(.register_views(con, tables, progress = progress))
}

#' Create any of `tables` that is not registered yet
#'
#' `con$views` is an environment, so a view registered through one copy of the
#' connection is visible from every other.
#' @noRd
.register_views <- function(con, tables, progress = FALSE) {
  pending <- setdiff(tables, ls(con$views))
  progress <- progress && length(pending) > 0
  if (progress) {
    cli::cli_progress_bar(
      format = "Registering {cli::pb_current}/{cli::pb_total} {.val {tbl}} {cli::pb_bar} {cli::pb_eta}",
      total = length(pending), clear = TRUE
    )
  }
  for (tbl in pending) {
    if (progress) cli::cli_progress_update()
    sql <- sprintf(
      "CREATE OR REPLACE VIEW %s AS SELECT * FROM read_parquet('%s/%s.parquet')",
      tbl, con$data_url, tbl
    )
    ok <- tryCatch(
      {
        DBI::dbExecute(con$db, sql)
        TRUE
      },
      error = function(e) {
        cli::cli_warn("Could not register view {.val {tbl}}: {e$message}")
        FALSE
      }
    )
    if (ok) assign(tbl, TRUE, envir = con$views)
  }
  if (progress) cli::cli_progress_done()
  invisible(ls(con$views))
}

#' Register the views a statement names, before DuckDB has to resolve them
#' @noRd
.ensure_views <- function(con, sql) {
  named <- con$tables[vapply(con$tables, grepl, logical(1), x = sql, fixed = TRUE)]
  invisible(.register_views(con, named))
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
