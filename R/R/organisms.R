#' List all organisms
#'
#' Distinct organisms across every archive. Served by the API: the organism
#' tables were dropped from the Parquet export when it was reorganised.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param common_names Keep the common-name column.
#'
#' @return A tibble of organism names.
#'
#' @export
#' @examples
#' \dontrun{
#' organisms()
#' }
organisms <- function(common_names = FALSE, con = .con()) {
  .check_connection(con)
  res <- .api_get(con, "/organisms")
  names_vec <- unlist(res$organisms %||% list(), use.names = FALSE)
  out <- tibble::tibble(organism = as.character(names_vec))
  if (common_names) {
    out$common_name <- NA_character_
  }
  out
}

#' Organism growth over time
#'
#' Monthly counts for one organism across the archives.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param organism Scientific name, for example `"Homo sapiens"`.
#' @param db Restrict to one source: `"geo"`, `"sra"`, `"arrayexpress"` or
#'   `"ena"`.
#'
#' @return A tibble of counts by month.
#'
#' @export
organism_growth <- function(organism, db = NULL, con = .con()) {
  .check_connection(con)
  rlang::check_required(organism)
  if (!is.null(db)) db <- match.arg(db, .valid_dbs)
  res <- .api_get(con, "/stats/organism-growth", organism = organism, db = db)
  series <- res$series %||% list()
  sources <- if (is.null(db)) names(series) else intersect(db, names(series))
  frames <- lapply(sources, function(src) {
    rows <- .records_to_tibble(series[[src]])
    if (nrow(rows) == 0) NULL else cbind(db = src, rows)
  })
  frames <- Filter(Negate(is.null), frames)
  if (length(frames) == 0) tibble::tibble() else tibble::as_tibble(do.call(rbind, frames))
}

#' Organism totals
#'
#' The organisms with the most records, most first.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param year_from Earliest year to count.
#' @param year_to Latest year to count.
#' @param limit Maximum organisms to return.
#'
#' @return A tibble of organisms and counts.
#'
#' @export
organism_totals <- function(year_from = NULL, year_to = NULL, limit = 50, con = .con()) {
  .check_connection(con)
  records <- .api_get(
    con, "/stats/organism-totals",
    year_from = year_from, year_to = year_to, limit = limit
  )
  .records_to_tibble(.as_record_list(records))
}

#' Search organisms by name
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param query Search text, matched against scientific and common names.
#' @param limit Maximum results.
#'
#' @return A tibble of matching organisms.
#'
#' @export
#' @examples
#' \dontrun{
#' organism_search("sapiens")
#' }
organism_search <- function(query, limit = 20, con = .con()) {
  .check_connection(con)
  rlang::check_required(query)
  records <- .api_get(con, "/stats/organism-search", q = query, limit = limit)
  .records_to_tibble(.as_record_list(records))
}

#' Common name for a scientific name
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param scientific_name A scientific name, for example `"Homo sapiens"`.
#'
#' @return A tibble with `tax_id`, `scientific_name` and `common_name`.
#'
#' @export
#' @examples
#' \dontrun{
#' common_name("Homo sapiens")
#' }
common_name <- function(scientific_name, con = .con()) {
  .check_connection(con)
  rlang::check_required(scientific_name)
  records <- .api_get(con, "/common-name", scientific_name = scientific_name)
  .records_to_tibble(.as_record_list(records))
}
