#' Search every archive
#'
#' `seqout_search()` searches seven public repositories at the same time: GEO,
#' SRA, ArrayExpress, ENA, GSA, DRA and GEA. It is the only search function.
#'
#' Give a query, filters, or both. A query alone searches the title, the summary
#' and the design of every study, and the server ranks the results. Give the filters by name through `...`.
#' The filters select the endpoint that answers: a filter that only the
#' structured search accepts selects that search. If you give no such filter,
#' the full-text search answers and ranks the results.
#'
#' \describe{
#'   \item{Both searches}{`organism`, `library_strategy`, `platform`}
#'   \item{Full-text only}{`db`, `library_source`, `date_from`, `date_to`}
#'   \item{Structured only}{`source`, `country`, `center`, `journal`,
#'   TODO: We should make all these support for both searches too!
#'     `instrument_model`, `year_from`, `year_to`, `multi_platform`,
#'     `assay_l1`, `assay_l2`, `geo_country_code_iso2`, `geo_lat`, `geo_lng`,
#'     `geo_radius_km`}
#' }
#'
#' A name that is not in this set causes an error. The error message shows the
#' names that are correct.
#'
#' `db` and `source` select one archive. The two names do the same thing.
#'
#' `date_from` and `date_to` take a day, as `yyyy-mm-dd`. They bound
#' `updated_at`, the day when seqout last saw a change to the record.
#'
#' `year_from` and `year_to` take whole years. The date that they bound follows
#' the endpoint that the other filters selected: the publication date in a
#' structured search, `updated_at` in a full-text search. Give one more
#' structured filter when you mean the publication year.
#'
#' This function reads the REST API only. For the Parquet dump, write SQL with
#' [query()]. SQL is a better tool for a filter or a count over the full index.
#'
#' @param query Character. The text to search for. It is not necessary if you
#'   give a filter.
#' @param ... The filters, by name, from the set above.
#' @param sortby `"citations"`, `"journal"` or `"year"`. The default order is
#'   relevance.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit The maximum number of rows. The default, `NULL`, returns every
#'   match. The server sends 200 rows in one page, so a large result set costs
#'   more than one request. Give `limit` when a sample is sufficient.
#' @inheritParams project
#'
#' @return A tibble of results, with a `took_ms` attribute.
#'
#' @seealso `vignette("searching")` for the filters and the costs.
#'
#' @export
#' @examples
#' \dontrun{
#' seqout_search("liver cancer scRNA")
#' seqout_search("liver cancer scRNA", db = "geo", sortby = "citations")
#'
#' # A structured filter selects the structured search
#' seqout_search("liver cancer", organism = "Homo sapiens", year_from = 2022)
#'
#' # A query is not necessary
#' seqout_search(organism = "Mus musculus", assay_l1 = "Transcriptomic")
#'
#' # Take a sample of a large result set
#' seqout_search("cancer", limit = 50)
#' }
seqout_search <- function(query = NULL, ..., sortby = NULL, order = "desc",
                          limit = NULL, con = .con()) {
  .check_connection(con)
  if (identical(con$backend, "parquet")) {
    cli::cli_abort(c(
      "{.fn seqout_search} reads the REST API; this connection is Parquet.",
      i = "Drop {.arg con} to search, or use {.fn query} to write SQL over the dump."
    ))
  }
  order <- match.arg(order, c("desc", "asc"))
  if (!is.null(sortby)) {
    sortby <- match.arg(sortby, c("citations", "journal", "year"))
  }

  filters <- .compact(list(...))
  .check_filter_names(filters)
  .check_iso_dates(filters)
  if (is.null(query) && length(filters) == 0) {
    cli::cli_abort("Give {.arg query}, at least one filter, or both.")
  }

  structured <- any(names(filters) %in% .structured_only)
  if (structured) {
    .reject_filters(filters, .fulltext_only)
  }
  # `db` and `source` name the same thing on the two endpoints.
  if (structured && !is.null(filters$db)) {
    filters$source <- filters$db
    filters$db <- NULL
  }
  if (!structured && !is.null(filters$source)) {
    filters$db <- filters$source
    filters$source <- NULL
  }

  out <- .paginate_api(
    con,
    if (structured) "/search/structured" else "/search",
    .compact(c(list(q = query, sortby = sortby, order = order), filters)),
    # No limit means every page; a limit needs only enough pages to reach it.
    max_pages = if (is.null(limit)) Inf else ceiling(limit / 200)
  )
  if (!is.null(limit) && nrow(out) > limit) {
    keep <- attributes(out)[c("total", "took_ms")]
    out <- out[seq_len(limit), , drop = FALSE]
    attributes(out)[names(keep)] <- keep
  }
  out
}

#' Filters both endpoints accept
#' @noRd
.shared_filters <- c("organism", "library_strategy", "platform")

#' Filters only the full-text `/search` accepts
#'
#' `db` is deliberately absent: it is the full-text spelling of `source`, so a
#' structured search translates it rather than rejecting it.
#' @noRd
.fulltext_only <- c("library_source", "date_from", "date_to")

#' Filters only `/search/structured` accepts
#' @noRd
.structured_only <- c(
  "country", "center", "journal", "instrument_model", "year_from", "year_to",
  "multi_platform", "assay_l1", "assay_l2", "geo_country_code_iso2",
  "geo_lat", "geo_lng", "geo_radius_km"
)

#' Every name `...` may carry
#' @noRd
.search_filters <- sort(c(
  .shared_filters, .fulltext_only, .structured_only, "db", "source"
))

#' @noRd
.check_filter_names <- function(filters) {
  if (!length(filters)) {
    return(invisible(NULL))
  }
  nms <- names(filters)
  if (is.null(nms) || any(!nzchar(nms))) {
    cli::cli_abort("Every filter in {.arg ...} must be named.")
  }
  bad <- setdiff(nms, .search_filters)
  if (length(bad)) {
    known <- .search_filters
    cli::cli_abort(c(
      "{.arg {bad}} {?is/are} not a search filter.",
      i = "Available: {.arg {known}}."
    ))
  }
  invisible(NULL)
}

#' @noRd
.check_iso_dates <- function(filters) {
  given <- intersect(names(filters), c("date_from", "date_to"))
  bad <- given[!vapply(
    filters[given],
    function(v) is.character(v) && grepl("^\\d{4}-\\d{2}-\\d{2}$", v),
    logical(1)
  )]
  if (length(bad) == 0) {
    return(invisible(NULL))
  }
  cli::cli_abort(c(
    "{.arg {bad}} must be an ISO date string, {.val yyyy-mm-dd}.",
    i = "Got {.val {unlist(filters[bad])}}.",
    i = "A {.cls Date} works too: {.code format(as.Date(x))}."
  ))
}

#' @noRd
.reject_filters <- function(filters, unsupported) {
  bad <- intersect(names(filters), unsupported)
  if (length(bad) == 0) {
    return(invisible(NULL))
  }
  cli::cli_abort(c(
    "{.arg {bad}} {?is/are} not available in a structured search.",
    i = "Drop {cli::qty(length(bad))}{?it/them}, or drop the structured filters
         to search full-text."
  ))
}


#' Run several searches in one call
#'
#' @param queries A character vector of search terms.
#' @param ... Filters applied to every search.
#' @inheritParams project
#'
#' @return A named list of tibbles, one per query.
#'
#' @export
bulk_search <- function(queries, ..., con = .con()) {
  .check_connection(con)
  rlang::check_required(queries)
  out <- lapply(queries, function(q) {
    tryCatch(seqout_search(q, ..., con = con), error = function(e) tibble::tibble())
  })
  stats::setNames(out, queries)
}
