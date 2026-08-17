#' Materialise a remote view as a local DuckDB table
#'
#' Downloads all rows from a remote Parquet view and stores them in the local
#' DuckDB database. Subsequent queries on this table hit local storage instead
#' of making HTTP requests — useful for repeated analysis on the same data.
#'
#' @param table Character. Name of the table/view to cache (e.g.,
#'   `"geo_series"`). Must be one of the registered SeqOut tables.
#' @param con A Parquet `seqout_connection` from [seqout_connect()].
#' @return The local table name (invisibly).
#' @export
cache_table <- function(table, con = .con()) {
  .need_parquet(con, "cache_table")
  check_required(table)

  if (!table %in% con$tables) {
    cli::cli_abort(
      "{.val {table}} is not a registered SeqOut table. See {.fn tables}."
    )
  }

  local_name <- paste0(table, "_local")
  .register_views(con, table)


  cli::cli_alert_info("Caching {.val {table}} locally as {.val {local_name}}...")

  n <- DBI::dbExecute(con$db, sprintf(
    "CREATE OR REPLACE TABLE \"%s\" AS SELECT * FROM \"%s\"",
    local_name, table
  ))
  cli::cli_alert_success("Cached {.val {table}}: {format(n, big.mark = ',')} rows")

  invisible(local_name)
}


#' Run arbitrary SQL on the Seqout DuckDB connection
#'
#' Executes any SQL query against the DuckDB database, which includes remote
#' Parquet views and any locally cached tables.
#'
#' @param sql Character. SQL query to execute.
#' @param params Optional. A list of parameters for parameterised queries.
#' @param con A Parquet `seqout_connection` from [seqout_connect()].
#' @return A tibble with query results.
#' @export
#' @examples
#' \dontrun{
#' con <- SeqoutConnect("parquet")
#' Query("SELECT accession, title FROM geo_series LIMIT 10", con = con)
#'
#' SeqoutDefault(con) # or make it the session default
#' Query("
#'   SELECT dominant_scientific_name AS organism, count(*) AS n
#'   FROM unified_metadata
#'   WHERE dominant_scientific_name IS NOT NULL
#'   GROUP BY organism
#'   ORDER BY n DESC
#'   LIMIT 20
#' ")
#' }
query <- function(sql, params = NULL, con = .con()) {
  .need_parquet(con, "query")
  check_required(sql)
  .db_query(con, sql, params = params)
}


#' List available tables and views
#'
#' Every remote SeqOut table, plus any table cached locally by [cache_table()].
#' `registered` says whether the view exists in DuckDB yet; views are created on
#' first use, so a fresh connection reports `FALSE` for most of them.
#'
#' @param con A Parquet `seqout_connection` from [seqout_connect()].
#' @return A tibble with `table_name`, `table_type` and `registered` columns.
#' @export
tables <- function(con = .con()) {
  .need_parquet(con, "tables")
  live <- .db_query(con, "
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'main'
  ")
  remote <- tibble::tibble(
    table_name = setdiff(con$tables, live$table_name),
    table_type = "VIEW"
  )
  live$registered <- TRUE
  remote$registered <- FALSE
  out <- rbind(live, remote)
  out[order(out$table_type, out$table_name), ]
}


#' Clear locally cached tables
#'
#' Removes all `*_local` tables created by [cache_table()].
#'
#' @param con A Parquet `seqout_connection` from [seqout_connect()].
#' @return Number of tables removed (invisibly).
#' @export
clear_cache <- function(con = .con()) {
  .need_parquet(con, "clear_cache")

  tables <- DBI::dbGetQuery(con$db, "
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_type = 'BASE TABLE'
      AND table_name LIKE '%_local'
  ")$table_name

  for (tbl in tables) {
    DBI::dbExecute(con$db, sprintf("DROP TABLE IF EXISTS \"%s\"", tbl))
  }

  if (length(tables) > 0) {
    cli::cli_alert_info("Cleared {length(tables)} cached table{?s}.")
  }

  invisible(length(tables))
}
