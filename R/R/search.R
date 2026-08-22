#' Search every archive
#'
#' `seqout_search()` searches seven public repositories at the same time: GEO,
#' SRA, ArrayExpress, ENA, GSA, DRA and GEA. It is the only search function.
#'
#' Give a query, filters, or both. A query alone searches the title, the summary
#' and the design of every study, and the server ranks the results. Give the
#' filters by name through `...`.
#'
#' Every filter works with a query and without one, and every filter combines
#' with every other one, with a single exception: `library_source` cannot be
#' used together with `assay_l1`, `assay_l2` or a `geo_*` filter.
#'
#' The set is `db`, `source`, `organism`, `library_strategy`, `library_source`,
#' `platform`, `country`, `journal`, `instrument_model`, `multi_platform`,
#' `date_from`, `date_to`, `assay_l1`, `assay_l2`, `geo_country_code_iso2`,
#' `geo_lat`, `geo_lng` and `geo_radius_km`. A name outside it causes an error,
#' and the error message shows the names that are correct.
#'
#' `db` and `source` select one archive. The two names do the same thing.
#'
#' `date_from` and `date_to` take a day, as `yyyy-mm-dd`. They bound
#' `updated_at`, the day when seqout last saw a change to the record. They are
#' the only time bounds.
#'
#' A query expands before it runs. The server adds the synonyms of each term
#' from eight ontologies, so a search for `"masld"` also finds "nafld". Set
#' `expand = FALSE` to search the words as you typed them. Give
#' `exclude_ontology` to keep one source out of the synonyms and keep the rest.
#' The website has the same two controls.
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
#' @param structured Read `query` as a boolean expression, and take its terms
#'   exactly: no ontology expansion, no spelling correction. A query that
#'   already carries `()`, `""`, `*` or an uppercase `OR`/`AND`/`NOT` is read
#'   that way anyway, so this is for forcing it on a query with no operators.
#' @param expand Expand each term with its ontology synonyms. `TRUE` is the
#'   default. `FALSE` searches the words as typed, which is what `structured`
#'   does. A filter from the structured set makes a search that never expands,
#'   so this parameter does nothing there.
#' @param exclude_ontology Character vector. The ontologies to keep out of the
#'   expansion, from `MONDO`, `MeSH`, `HGNC`, `CHEBI`, `UBERON`, `CL`, `EFO` and
#'   `CVCL`. A term that two ontologies know stays while one of the two is on,
#'   because the graph holds one node for each name.
#' @inheritParams project
#'
#' @return A tibble of results, with a `took_ms` attribute.
#'
#' @seealso [sample_search()] when the answer should be samples, and the
#'   Search article for the filters and the costs.
#'
#' @export
#' @examples
#' \dontrun{
#' SeqoutSearch("liver cancer scRNA")
#' SeqoutSearch("liver cancer scRNA", db = "geo", sortby = "citations")
#'
#' # Filters combine freely
#' SeqoutSearch("liver cancer", organism = "Homo sapiens", country = "Japan")
#'
#' # A query is not necessary
#' SeqoutSearch(organism = "Mus musculus", assay_l1 = "Transcriptomic")
#'
#' # Take a sample of a large result set
#' SeqoutSearch("cancer", limit = 50)
#'
#' # A boolean query is read as one without being asked
#' SeqoutSearch('("aging" OR "aged") (gut OR colon) immun*')
#'
#' # The same reading, forced on a query that carries no operators
#' SeqoutSearch("liver cancer", structured = TRUE)
#'
#' # The words as typed, with no ontology synonyms
#' SeqoutSearch("spinal muscular atrophy", expand = FALSE)
#'
#' # Every ontology except two of them
#' SeqoutSearch("spinal muscular atrophy", exclude_ontology = c("MeSH", "CVCL"))
#' }
seqout_search <- function(query = NULL, ..., sortby = NULL, order = "desc",
                          limit = NULL, structured = FALSE, expand = TRUE,
                          exclude_ontology = NULL, con = .con()) {
  .need_api(
    con, "seqout_search",
    why = "Use {.fn query} to write SQL over the dump."
  )
  order <- match.arg(order, c("desc", "asc"))
  if (!is.null(sortby)) {
    sortby <- match.arg(sortby, c("citations", "journal", "year"))
  }
  if (!is.logical(structured) || length(structured) != 1 || is.na(structured)) {
    cli::cli_abort("{.arg structured} must be {.code TRUE} or {.code FALSE}.")
  }
  if (!is.logical(expand) || length(expand) != 1 || is.na(expand)) {
    cli::cli_abort("{.arg expand} must be {.code TRUE} or {.code FALSE}.")
  }
  exclude_ontology <- .check_ontologies(exclude_ontology)

  filters <- .compact(list(...))
  .check_filter_names(filters)
  .check_iso_dates(filters)
  if (is.null(query) && length(filters) == 0) {
    cli::cli_abort("Give {.arg query}, at least one filter, or both.")
  }

  narrowed <- any(names(filters) %in% .structured_only)
  .check_boolean_reachable(query, structured, filters, narrowed)
  if (narrowed && length(exclude_ontology)) {
    cli::cli_abort(c(
      "{.arg exclude_ontology} cannot be combined with
       {.arg {intersect(names(filters), .structured_only)}}.",
      i = "That search does not expand terms, so there is nothing to switch off."
    ))
  }
  # The date bounds and the sort are not parameters of the structured endpoint,
  # which would drop them without a word. Apply them here instead, off columns
  # that come back on every row, so a filter means one thing either way.
  local <- list()
  if (narrowed) {
    .reject_filters(filters, setdiff(.fulltext_only, .local_filters))
    local <- filters[intersect(names(filters), .local_filters)]
    filters <- filters[setdiff(names(filters), .local_filters)]
  }
  # `db` and `source` name the same thing on the two endpoints.
  if (narrowed && !is.null(filters$db)) {
    filters$source <- filters$db
    filters$db <- NULL
  }
  if (!narrowed && !is.null(filters$source)) {
    filters$db <- filters$source
    filters$source <- NULL
  }

  local_sort <- narrowed && !is.null(sortby)
  # A row dropped or reordered in R has to be dropped or reordered before
  # `limit` counts, so this path reads every page and cuts at the end. Asking
  # for one page would return the first 200 rows minus whatever R removed.
  walk_all <- length(local) > 0 || local_sort

  out <- .paginate_api(
    con,
    if (narrowed) "/search/structured" else "/search",
    .compact(c(
      list(q = query),
      # Expansion off is the same exact-terms reading that `structured` forces,
      # so the two arrive as one flag. One comma-joined parameter carries the
      # ontologies, which is the shape the server and the website both use.
      # /search/structured has no such parameter and never expands anyway, so
      # `expand = FALSE` is already true of it and nothing is sent.
      if (!narrowed && (structured || !expand)) list(structured = "true"),
      if (length(exclude_ontology)) {
        list(exclude_ontology = paste(exclude_ontology, collapse = ","))
      },
      if (!local_sort) list(sortby = sortby, order = order),
      filters
    )),
    max_pages = if (is.null(limit) || walk_all) Inf else ceiling(limit / 200)
  )
  out <- .apply_local_filters(out, local)
  if (local_sort) {
    out <- .sort_results(out, sortby, order)
  }
  if (!is.null(limit) && nrow(out) > limit) {
    keep <- attributes(out)[c("total", "took_ms")]
    out <- out[seq_len(limit), , drop = FALSE]
    attributes(out)[names(keep)] <- keep
  }
  out
}

#' Apply the day bounds in R, on the column the server would have used
#'
#' The server's own clause is `matched.updated_at::date >= date_from`, and
#' `updated_at` is on every result row, so this is the same answer rather than
#' an approximation of it.
#' @noRd
.apply_local_filters <- function(out, local) {
  if (length(local) == 0 || nrow(out) == 0) {
    return(out)
  }
  if (!"updated_at" %in% names(out)) {
    cli::cli_warn(
      "No {.field updated_at} column came back; {.arg {names(local)}} not applied."
    )
    return(out)
  }
  seen <- as.Date(substr(as.character(out$updated_at), 1, 10))
  keep <- !is.na(seen)
  if (!is.null(local$date_from)) keep <- keep & seen >= as.Date(local$date_from)
  if (!is.null(local$date_to)) keep <- keep & seen <= as.Date(local$date_to)
  .keep_rows(out, keep)
}

#' Reorder in R what the structured endpoint has no `sortby` to do
#' @noRd
.sort_results <- function(out, sortby, order) {
  column <- c(citations = "citation_count", journal = "journal", year = "updated_at")[[sortby]]
  if (nrow(out) == 0 || !column %in% names(out)) {
    return(out)
  }
  value <- out[[column]]
  value <- if (identical(sortby, "citations")) {
    v <- suppressWarnings(as.numeric(value))
    ifelse(is.na(v), 0, v)
  } else {
    v <- as.character(value)
    ifelse(is.na(v), "", v)
  }
  .keep_rows(out, order(value, decreasing = identical(order, "desc")))
}

#' Subset rows, carrying the attributes the caller reads
#' @noRd
.keep_rows <- function(out, i) {
  keep <- attributes(out)[c("total", "took_ms")]
  out <- out[i, , drop = FALSE]
  attributes(out)[names(keep)] <- keep
  out
}

#' Filters both endpoints accept
#'
#' `country`, `journal`, `instrument_model` and `multi_platform` are here
#' because `/search` takes all four -- they are what the website's own sidebar
#' sends it (`components/search-page-body.tsx`). Routing them to the structured
#' endpoint, as this package used to, made `country` mean the contributor's
#' postal address instead of the study's country.
#' @noRd
.shared_filters <- c(
  "organism", "library_strategy", "platform", "country", "journal",
  "instrument_model", "multi_platform"
)

#' Filters only the full-text `/search` accepts
#'
#' `db` is deliberately absent: it is the full-text spelling of `source`, so a
#' structured search translates it rather than rejecting it.
#' @noRd
.fulltext_only <- c("library_source", "date_from", "date_to")

#' Full-text-only filters this package applies itself
#'
#' The structured endpoint has no `date_from`/`date_to` and would ignore them
#' silently. It does return `updated_at` on every row, which is the column the
#' full-text endpoint bounds, so the same answer is reachable here.
#' @noRd
.local_filters <- c("date_from", "date_to")

#' Filters only `/search/structured` accepts
#'
#' `year_from`/`year_to` and `center` used to be here and are gone. The two year
#' bounds meant the publication year on this endpoint and `updated_at` on the
#' other, so `date_from`/`date_to` are now the only time bounds -- the same call
#' the website makes. `center_name` comes back on every row, so `center` is
#' better done with a filter over the result.
#' @noRd
.structured_only <- c(
  "assay_l1", "assay_l2", "geo_country_code_iso2",
  "geo_lat", "geo_lng", "geo_radius_km"
)

#' Every name `...` may carry
#' @noRd
.search_filters <- sort(c(
  .shared_filters, .fulltext_only, .structured_only, "db", "source"
))

#' The ontologies the search expands with
#'
#' Mirrors `ONTOLOGIES` in the server's `expansions.py` and the toggles on the
#' website. The server ignores a name it does not know, so an unknown one keeps
#' every synonym and looks like a control that does nothing.
#' @noRd
.ontologies <- c(
  "MONDO", "MeSH", "HGNC", "CHEBI", "UBERON", "CL", "EFO", "CVCL"
)

#' Take the name whatever the capitals, and refuse a name that is not one
#' @noRd
.check_ontologies <- function(x) {
  if (is.null(x) || length(x) == 0) {
    return(NULL)
  }
  if (!is.character(x)) {
    cli::cli_abort("{.arg exclude_ontology} must be a character vector.")
  }
  x <- trimws(x)
  hit <- match(tolower(x), tolower(.ontologies))
  bad <- x[is.na(hit)]
  if (length(bad)) {
    cli::cli_abort(c(
      "{.val {bad}} {?is/are} not an ontology this search expands with.",
      i = "Available: {.val {.ontologies}}."
    ))
  }
  unique(.ontologies[hit])
}

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

#' Does this query read as a boolean expression?
#'
#' The server decides this itself, and this has to agree with it or the warning
#' below fires on the wrong queries. Mirrors `_TRIGGER` in the API's
#' `boolean_query.py`: a group, a quoted phrase, a `*` wildcard, or a
#' standalone uppercase `OR`/`AND`/`NOT`. Lowercase "colon or gut" is prose.
#' @noRd
.is_boolean_query <- function(q) {
  !is.null(q) && grepl('[()"*]|\\b(OR|AND|NOT)\\b', q)
}

#' Refuse to flatten a boolean query into a bag of words
#'
#' Only the full-text endpoint parses booleans. The other one takes `q` as
#' prose, so `liver NOT mouse` would quietly come back as everything matching
#' "liver", "not" and "mouse" -- wrong, and wrong without a word. Unlike the
#' date bounds, nothing here can be repaired in R.
#' @noRd
.check_boolean_reachable <- function(query, structured, filters, narrowed) {
  if (!narrowed || !(structured || .is_boolean_query(query))) {
    return(invisible(NULL))
  }
  with <- intersect(names(filters), .structured_only)
  cli::cli_abort(c(
    "A boolean {.arg query} cannot be combined with {.arg {with}}.",
    "i" = "Only the full-text search reads {.code ()}, {.code \"\"}, {.code *}
           and {.code OR}/{.code AND}/{.code NOT}; the other one would read
           them as words.",
    "i" = "Drop {.arg {with}}, or write {.arg query} as plain text."
  ))
}

#' The one pair of filters no search can answer at the same time
#' @noRd
.reject_filters <- function(filters, unsupported) {
  bad <- intersect(names(filters), unsupported)
  if (length(bad) == 0) {
    return(invisible(NULL))
  }
  with <- intersect(names(filters), .structured_only)
  cli::cli_abort(c(
    "{.arg {bad}} cannot be combined with {.arg {with}}.",
    i = "No search answers both. Drop {cli::qty(length(bad))}{?it/them},
         or drop {.arg {with}}."
  ))
}
