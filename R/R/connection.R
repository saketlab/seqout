#' Connect to the SeqOut database
#'
#' Creates a DuckDB connection with remote Parquet views registered for all
#' SeqOut tables. Uses DuckDB's httpfs extension to query Parquet files hosted
#' on seqout.org without downloading them entirely.
#'
#' @param base_url Base URL of the SeqOut server. Defaults to
#'   `"https://seqout.org"`.
#' @param read_only If `TRUE`, the DuckDB connection is read-only.
#'   Defaults to `FALSE` so that [sq_cache_table()] can materialise views
#'   locally.
#'
#' @return A `seqout_connection` object (list) containing the DuckDB
#'   connection handle and configuration.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- connect_seqout()
#' sq_query(con, "SELECT * FROM geo_series LIMIT 5")
#' close_seqout(con)
#' }
connect_seqout <- function(base_url = "https://seqout.org",
                           read_only = FALSE) {
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

  # Keep in sync with EXPORT_TABLES in pysradb-server/scripts/export_parquet.py
  tables <- .seqout_tables()
  ok <- vapply(tables, function(tbl) {
    url <- paste0(data_url, "/", tbl, ".parquet")
    sql <- sprintf(
      "CREATE OR REPLACE VIEW %s AS SELECT * FROM read_parquet('%s')",
      tbl, url
    )
    tryCatch(
      {
        DBI::dbExecute(db, sql)
        TRUE
      },
      error = function(e) {
        cli::cli_warn("Could not register view {.val {tbl}}: {e$message}")
        FALSE
      }
    )
  }, logical(1))
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
#' @param con A `seqout_connection` returned by [connect_seqout()].
#'
#' @export
close_seqout <- function(con) {
  .check_connection(con)
  DBI::dbDisconnect(con$db, shutdown = TRUE)
  cli::cli_alert_info("SeqOut connection closed.")
  invisible(NULL)
}


#' @export
close.seqout_connection <- function(con, ...) {
  close_seqout(con)
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


#' Keep in sync with EXPORT_TABLES in pysradb-server/scripts/export_parquet.py.
#' @noRd
.seqout_tables <- function() {
  c(
    "geo_series", "geo_samples",
    "sra_studies", "sra_experiments", "sra_samples",
    "ena_studies", "ena_experiments",
    "arrayexpress_experiments", "arrayexpress_samples",
    "pubmed_metadata", "unified_metadata",
    "enriched_samples", "enriched_studies_v3", "ontology_samples_v3",
    "cross_ref_geo", "cross_ref_ae",
    "common_names", "organism_growth_monthly", "study_publications"
  )
}

#' @noRd
.check_connection <- function(con) {
  if (!inherits(con, "seqout_connection")) {
    cli::cli_abort(
      "{.arg con} must be a {.cls seqout_connection} (from {.fn connect_seqout})."
    )
  }
  invisible(con)
}
