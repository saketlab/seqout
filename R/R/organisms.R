#' List all organisms
#'
#' Returns distinct organisms across all databases, queried from the
#' `organism_growth_monthly` materialized view.
#'
#' @param con A `seqout_connection`.
#' @param common_names If `TRUE`, include common name mappings. Default `FALSE`.
#' @return A tibble of organism names. If `common_names = TRUE`, includes
#'   a `common_name` column.
#' @export
sq_organisms <- function(con, common_names = FALSE) {
  .check_connection(con)

  if (common_names) {
    sql <- "
      SELECT DISTINCT o.organism, c.common_name
      FROM organism_growth_monthly o
      LEFT JOIN common_names c ON o.organism = c.scientific_name
      ORDER BY o.organism
    "
  } else {
    sql <- "
      SELECT DISTINCT organism
      FROM organism_growth_monthly
      ORDER BY organism
    "
  }

  .db_query(con, sql)
}


#' Get organism growth over time
#'
#' Monthly experiment counts for a specific organism across databases.
#'
#' @param con A `seqout_connection`.
#' @param organism Character. Scientific name (e.g., `"Homo sapiens"`).
#' @param db Optional. Restrict to `"geo"`, `"sra"`, `"arrayexpress"`, or
#'   `"ena"`.
#' @return A tibble with columns `db`, `month`, `count`.
#' @export
sq_organism_growth <- function(con, organism, db = NULL) {
  .check_connection(con)
  check_required(organism)
  if (!is.null(db)) db <- match.arg(db, .valid_dbs)

  if (!is.null(db)) {
    sql <- "
      SELECT db, month, count
      FROM organism_growth_monthly
      WHERE lower(organism) = lower(?) AND db = ?
      ORDER BY month
    "
    params <- list(organism, db)
  } else {
    sql <- "
      SELECT db, month, count
      FROM organism_growth_monthly
      WHERE lower(organism) = lower(?)
      ORDER BY db, month
    "
    params <- list(organism)
  }

  .db_query(con, sql, params = params)
}


#' Get total experiment counts per organism
#'
#' @param con A `seqout_connection`.
#' @param year_from Optional. Filter by publication year (start).
#' @param year_to Optional. Filter by publication year (end).
#' @param limit Maximum organisms to return. Default 50.
#' @return A tibble with organism names and total counts.
#' @export
sq_organism_totals <- function(con, year_from = NULL, year_to = NULL,
                               limit = 50) {
  .check_connection(con)

  clauses <- character()
  params <- list()
  if (!is.null(year_from)) {
    clauses <- c(clauses, "extract(year FROM month) >= ?")
    params <- c(params, list(as.integer(year_from)))
  }
  if (!is.null(year_to)) {
    clauses <- c(clauses, "extract(year FROM month) <= ?")
    params <- c(params, list(as.integer(year_to)))
  }

  where <- if (length(clauses) > 0) paste("WHERE", paste(clauses, collapse = " AND ")) else ""
  sql <- sprintf("
    SELECT organism, sum(count) AS total
    FROM organism_growth_monthly
    %s
    GROUP BY organism
    ORDER BY total DESC
    LIMIT ?
  ", where)
  params <- c(params, list(as.integer(limit)))

  .db_query(con, sql, params = params)
}


#' Search organisms by partial name
#'
#' Typeahead/autocomplete search for organism names.
#'
#' @param con A `seqout_connection`.
#' @param query Character. Partial organism name.
#' @param limit Maximum results. Default 20.
#' @return A character vector of matching organism names.
#' @export
sq_organism_search <- function(con, query, limit = 20) {
  .check_connection(con)
  check_required(query)

  df <- .db_query(con, "
    SELECT DISTINCT organism
    FROM organism_growth_monthly
    WHERE lower(organism) LIKE lower(? || '%')
    LIMIT ?
  ", params = list(query, limit))
  df$organism
}
