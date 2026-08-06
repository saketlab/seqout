#' Materialise a remote view as a local DuckDB table
#'
#' Downloads all rows from a remote Parquet view and stores them in the local
#' DuckDB database. Subsequent queries on this table hit local storage instead
#' of making HTTP requests — useful for repeated analysis on the same data.
#'
#' @param con A `seqout_connection`.
#' @param table Character. Name of the table/view to cache (e.g.,
#'   `"geo_series"`). Must be one of the registered SeqOut tables.
#' @return The local table name (invisibly).
#' @export
cache_table <- function(con, table) {
  .check_connection(con)
  check_required(table)

  if (!table %in% con$tables) {
    cli::cli_abort(
      "{.val {table}} is not a registered SeqOut table. See {.fn tables}."
    )
  }

  local_name <- paste0(table, "_local")

  cli::cli_alert_info("Caching {.val {table}} locally as {.val {local_name}}...")

  DBI::dbExecute(con$db, sprintf(
    "CREATE OR REPLACE TABLE \"%s\" AS SELECT * FROM \"%s\"",
    local_name, table
  ))

  n <- DBI::dbGetQuery(con$db, sprintf("SELECT count(*) AS n FROM \"%s\"", local_name))$n
  cli::cli_alert_success("Cached {.val {table}}: {format(n, big.mark = ',')} rows")

  invisible(local_name)
}


#' Run arbitrary SQL on the SeqOut DuckDB connection
#'
#' Executes any SQL query against the DuckDB database, which includes remote
#' Parquet views and any locally cached tables.
#'
#' @param con A `seqout_connection`.
#' @param sql Character. SQL query to execute.
#' @param params Optional. A list of parameters for parameterised queries.
#' @return A tibble with query results.
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' query(con, "SELECT accession, title FROM geo_series LIMIT 10")
#' query(con, "
#'   SELECT organism, sum(count) AS total
#'   FROM organism_growth_monthly
#'   GROUP BY organism
#'   ORDER BY total DESC
#'   LIMIT 20
#' ")
#' }
query <- function(con, sql, params = NULL) {
  .check_connection(con)
  check_required(sql)
  .db_query(con, sql, params = params)
}


#' List available tables and views
#'
#' Shows all tables registered in the DuckDB connection, including both
#' remote Parquet views and locally cached tables.
#'
#' @param con A `seqout_connection`.
#' @return A tibble with `table_name` and `table_type` columns.
#' @export
tables <- function(con) {
  .check_connection(con)
  .db_query(con, "
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'main'
    ORDER BY table_type, table_name
  ")
}


#' Clear locally cached tables
#'
#' Removes all `*_local` tables created by [cache_table()].
#'
#' @param con A `seqout_connection`.
#' @return Number of tables removed (invisibly).
#' @export
clear_cache <- function(con) {
  .check_connection(con)

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
