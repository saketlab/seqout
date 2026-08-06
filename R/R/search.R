#' Full-text search across all databases
#'
#' Searches GEO, SRA, ArrayExpress, and ENA using PostgreSQL full-text search
#' on the server. Results are returned via the REST API since full-text ranking
#' requires server-side tsvector indexes.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param query Character. Search query string.
#' @param db Optional. Restrict to a database: `"geo"`, `"sra"`,
#'   `"arrayexpress"`, or `"ena"`.
#' @param sortby Optional. Sort results by `"citations"`, `"journal"`, or
#'   `"year"`.
#' @param order Sort order: `"desc"` (default) or `"asc"`.
#' @param cursor_rank,cursor_acc,cursor_sort Pagination cursors from a
#'   previous result's `next_cursor`.
#' @param max_pages Maximum number of pages to fetch. Defaults to 1.
#'   Set to `Inf` to fetch all results (use with care).
#'
#' @return A tibble of search results with columns varying by source database.
#'   Attributes `total` and `took_ms` are attached.
#' @export
seqout_search <- function(con, query,
                          db = NULL,
                          sortby = NULL,
                          order = "desc",
                          cursor_rank = NULL,
                          cursor_acc = NULL,
                          cursor_sort = NULL,
                          max_pages = 1) {
  .check_connection(con)
  check_required(query)
  if (!is.null(db)) db <- match.arg(db, .valid_dbs)
  order <- match.arg(order, c("desc", "asc"))

  params <- .compact(list(
    q = query, order = order, db = db, sortby = sortby,
    cursor_rank = cursor_rank, cursor_acc = cursor_acc,
    cursor_sort = cursor_sort
  ))

  .paginate_api(con, "/search", params, max_pages = max_pages)
}

#' Structured search with filters
#'
#' Advanced search combining free-text query with structured filters.
#'
#' @inheritParams seqout_search
#' @param organism Filter by scientific name (e.g., `"Homo sapiens"`).
#' @param library_strategy Filter by library strategy (e.g., `"RNA-Seq"`).
#' @param platform Filter by sequencing platform.
#' @param country Filter by country name.
#' @param center Filter by sequencing center.
#' @param year_from,year_to Filter by publication year range.
#' @param source Filter by source database.
#' @param journal Filter by journal name.
#' @param instrument_model Filter by instrument model.
#' @param assay_l1,assay_l2 Filter by assay level 1 or 2 classification.
#' @param geo_country,geo_country_code Filter by geographic country.
#' @param geo_city,geo_state,geo_district,geo_postcode Geographic filters.
#' @param geo_lat,geo_lng,geo_radius_km Geographic radius search.
#'
#' @return A tibble of search results.
#' @export
search_structured <- function(con, query = NULL,
                              organism = NULL,
                              library_strategy = NULL,
                              platform = NULL,
                              country = NULL,
                              center = NULL,
                              year_from = NULL,
                              year_to = NULL,
                              source = NULL,
                              journal = NULL,
                              instrument_model = NULL,
                              sortby = NULL,
                              order = "desc",
                              assay_l1 = NULL,
                              assay_l2 = NULL,
                              geo_country = NULL,
                              geo_country_code = NULL,
                              geo_city = NULL,
                              geo_state = NULL,
                              geo_district = NULL,
                              geo_postcode = NULL,
                              geo_lat = NULL,
                              geo_lng = NULL,
                              geo_radius_km = NULL,
                              cursor_rank = NULL,
                              cursor_acc = NULL,
                              cursor_sort = NULL,
                              max_pages = 1) {
  .check_connection(con)
  order <- match.arg(order, c("desc", "asc"))

  params <- .compact(list(
    q = query, organism = organism, library_strategy = library_strategy,
    platform = platform, country = country, center = center,
    year_from = year_from, year_to = year_to, source = source,
    journal = journal, instrument_model = instrument_model,
    sortby = sortby, order = order,
    assay_l1 = assay_l1, assay_l2 = assay_l2,
    geo_country = geo_country, geo_country_code = geo_country_code,
    geo_city = geo_city, geo_state = geo_state,
    geo_district = geo_district, geo_postcode = geo_postcode,
    geo_lat = geo_lat, geo_lng = geo_lng,
    geo_radius_km = geo_radius_km,
    cursor_rank = cursor_rank, cursor_acc = cursor_acc,
    cursor_sort = cursor_sort
  ))

  .paginate_api(con, "/search/structured", params, max_pages = max_pages)
}

#' Read every page of search results
#'
#' Follows the cursor until the results run out. Give `limit` unless you intend
#' to read the whole set, which can be large.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param query Search text.
#' @param limit Stop after this many results. `NULL` reads everything.
#' @param ... Filters passed to [seqout_search()], such as `db` or `sortby`.
#'
#' @return A tibble of results.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' iter_search(con, "lung cancer", db = "geo", limit = 100)
#' }
iter_search <- function(con, query, limit = NULL, ...) {
  .check_connection(con)
  rlang::check_required(query)
  pages <- if (is.null(limit)) 1000L else max(1L, ceiling(limit / 200))
  out <- seqout_search(con, query, ..., max_pages = pages)
  if (!is.null(limit) && nrow(out) > limit) out <- out[seq_len(limit), , drop = FALSE]
  out
}

#' Search results with the spelling correction the server suggests
#'
#' The correction rides on the first page only, so this costs one request.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param query Search text.
#' @param ... Filters passed to the search endpoint.
#'
#' @return A list with `correction` and `results`.
#'
#' @export
search_correction <- function(con, query, ...) {
  .check_connection(con)
  rlang::check_required(query)
  params <- .compact(list(q = query, ...))
  res <- do.call(.api_get, c(list(con, "/search"), params))
  list(
    correction = res$correction %||% NULL,
    results = .records_to_tibble(.as_record_list(res$results %||% res))
  )
}

#' Run several searches in one call
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param queries A character vector of search terms.
#' @param ... Filters applied to every search.
#'
#' @return A named list of tibbles, one per query.
#'
#' @export
bulk_search <- function(con, queries, ...) {
  .check_connection(con)
  rlang::check_required(queries)
  out <- lapply(queries, function(q) {
    tryCatch(seqout_search(con, q, ...), error = function(e) tibble::tibble())
  })
  stats::setNames(out, queries)
}
