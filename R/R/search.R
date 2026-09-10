#' Search every archive
#'
#' Searches GEO, SRA, ArrayExpress, ENA, GSA, DRA and GEA together.
#'
#' @param query Character. The text to search for; optional if you give a filter.
#' @param ... The filters, by name, from the set above.
#' @param sortby `"citations"`, `"journal"` or `"year"`. The default order is
#'   relevance.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum rows. `NULL` returns every match in 200-row pages.
#' @param structured Read `query` as a boolean expression with exact terms.
#' @param expand Expand terms with ontology synonyms. `FALSE` uses exact terms.
#' @param exclude_ontology Character vector. The ontologies to keep out of the
#'   expansion, from `MONDO`, `MeSH`, `HGNC`, `CHEBI`, `UBERON`, `CL`, `EFO` and
#'   `CVCL`. Shared ontology nodes remain while any source is kept.
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
#' # filters combine freely
#' SeqoutSearch("liver cancer", organism = "Homo sapiens", country = "Japan")
#'
#' # filters can search alone
#' SeqoutSearch(organism = "Mus musculus", assay_l1 = "Transcriptomic")
#'
#' # sample a large result set
#' SeqoutSearch("cancer", limit = 50)
#'
#' # boolean syntax triggers structured parsing
#' SeqoutSearch('("aging" OR "aged") (gut OR colon) immun*')
#'
#' # force structured parsing
#' SeqoutSearch("liver cancer", structured = TRUE)
#'
#' # exact words
#' SeqoutSearch("spinal muscular atrophy", expand = FALSE)
#'
#' # exclude ontology sources
#' SeqoutSearch("spinal muscular atrophy", exclude_ontology = c("MeSH", "CVCL"))
#'
#' # restrict to long-read (PacBio / Oxford Nanopore) studies
#' SeqoutSearch("liver fibrosis", long_read = TRUE)
#'
#' # long-read AND single-cell: filter the returned is_single_cell column locally
#' lr <- LongreadProjects(organism = "Homo sapiens")
#' lr[lr$is_single_cell %in% TRUE, ]
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

  filters <- .lower_bools(.compact(list(...)))
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
  # structured endpoint ignores dates and sort; apply them on returned columns
  local <- list()
  if (narrowed) {
    .reject_filters(filters, setdiff(.fulltext_only, .local_filters))
    local <- filters[intersect(names(filters), .local_filters)]
    filters <- filters[setdiff(names(filters), .local_filters)]
  }
  # db and source name the same field on different endpoints
  if (narrowed && !is.null(filters$db)) {
    filters$source <- filters$db
    filters$db <- NULL
  }
  if (!narrowed && !is.null(filters$source)) {
    filters$db <- filters$source
    filters$source <- NULL
  }

  local_sort <- narrowed && !is.null(sortby)
  # local filtering or sorting makes limit count after all pages
  walk_all <- length(local) > 0 || local_sort

  out <- .paginate_api(
    con,
    if (narrowed) "/search/structured" else "/search",
    .compact(c(
      list(q = query),
      # structured=true means exact terms and disables expansion
      # exclude_ontology is comma-joined to match the server and website
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

#' Both endpoints need one non-empty query to rank against
#' @noRd
.check_query <- function(query) {
  if (!rlang::is_string(query) || !nzchar(trimws(query))) {
    cli::cli_abort("{.arg query} must be one non-empty string.")
  }
  invisible(NULL)
}

#' Apply the day bounds in R, on the column the server would have used
#'
#' The full-text endpoint bounds `updated_at`, which every result row carries.
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

#' Sort locally for structured search
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
#' Shared names match the website sidebar and keep `country` as study country.
#' @noRd
.shared_filters <- c(
  "organism", "library_strategy", "platform", "country", "journal",
  "instrument_model", "multi_platform"
)

#' Filters only the full-text `/search` accepts
#'
#' `db` is translated to structured `source`. `long_read` restricts to
#' studies with a PacBio or Oxford Nanopore experiment, any archive.
#' @noRd
.fulltext_only <- c("library_source", "date_from", "date_to", "long_read")

#' Full-text filters applied locally for structured search
#'
#' `date_from` and `date_to` use returned `updated_at`.
#' @noRd
.local_filters <- c("date_from", "date_to")

#' Filters only `/search/structured` accepts
#'
#' Date and center filters stay local because endpoint semantics differ.
#' @noRd
.structured_only <- c(
  "assay_l1", "assay_l2",
  "geo_country", "geo_country_code", "geo_country_code_iso2",
  "geo_city", "geo_state", "geo_district", "geo_postcode",
  "geo_lat", "geo_lng", "geo_radius_km",
  "published_after", "published_before",
  "pub_date_after", "pub_date_before",
  "sample_tissue", "sample_disease", "sample_cell_type"
)

#' Filters the server validates as `yyyy-mm-dd`
#'
#' The server answers 422 for a day it cannot parse, so the shape is checked
#' here first.
#' @noRd
.date_filters <- c(
  "date_from", "date_to",
  "published_after", "published_before",
  "pub_date_after", "pub_date_before"
)

#' Every name `...` may carry
#' @noRd
.search_filters <- sort(c(
  .shared_filters, .fulltext_only, .structured_only, "db", "source"
))

#' The ontologies the search expands with
#'
#' Unknown ontology names would be ignored by the server, so reject them here.
#' @noRd
.ontologies <- c(
  "MONDO", "MeSH", "HGNC", "CHEBI", "UBERON", "CL", "EFO", "CVCL"
)

#' Normalize ontology names and reject unknown values
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
    # copy to a plain name so cli does not parse .ontologies as a style
    known <- .ontologies
    cli::cli_abort(c(
      "{.val {bad}} {?is/are} not an ontology this search expands with.",
      i = "Available: {.val {known}}."
    ))
  }
  unique(.ontologies[hit])
}

#' Refuse a filter name no endpoint has, and guess what was meant
#'
#' `noun` names the allowed set; `help` replaces long lists.
#' @noRd
.check_filter_names <- function(filters, allowed = .search_filters,
                                noun = "search filter", help = NULL) {
  if (!length(filters)) {
    return(invisible(NULL))
  }
  nms <- names(filters)
  if (is.null(nms) || any(!nzchar(nms))) {
    cli::cli_abort("Every filter in {.arg ...} must be named.")
  }
  bad <- setdiff(nms, allowed)
  if (!length(bad)) {
    return(invisible(NULL))
  }
  near <- allowed[colSums(utils::adist(bad, allowed, ignore.case = TRUE) <= 2) > 0]
  cli::cli_abort(c(
    "{.arg {bad}} {?is/are} not a {noun}.",
    i = if (length(near)) "Did you mean {.arg {near}}?",
    i = help %||% "Available: {.arg {allowed}}."
  ))
}

#' @noRd
.check_iso_dates <- function(filters) {
  given <- intersect(names(filters), .date_filters)
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
#' Mirrors the server trigger: grouping, quotes, wildcard, or uppercase boolean op.
#' @noRd
.is_boolean_query <- function(q) {
  !is.null(q) && grepl('[()"*]|\\b(OR|AND|NOT)\\b', q)
}

#' Refuse to flatten a boolean query into a bag of words
#'
#' Structured search reads boolean syntax as prose; R cannot repair that.
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


#' Count the matches of a search
#'
#' Groups the full [seqout_search()] match set by facet.
#'
#' Values order by `score`, the summed match rank. `score` is 0 without a query.
#'
#' @param query Character. The text to count the matches of. Required.
#' @param ... Filters, by name, to count *within*: `db`, `organism`, `country`,
#'   `library_strategy`, `library_source`, `instrument_model`, `platform`,
#'   `journal`, `multi_platform`, `year_from` and `year_to`.
#' @param structured Read `query` as a boolean expression, as [seqout_search()].
#' @param exclude_ontology Ontologies to keep out of the query expansion. See
#'   [seqout_search()].
#' @inheritParams project
#'
#' @return A tibble of `facet`, `value`, `count` and `score`, with `total` and
#'   `max_rank` attributes.
#'
#' @seealso [seqout_search()] for the results themselves, [search_suggest()]
#'   when a query returns nothing.
#'
#' @export
#' @examples
#' \dontrun{
#' f <- SearchFacets("liver cancer")
#' attr(f, "total")
#'
#' # organism facet
#' f[f$facet == "organism", ]
#'
#' # count within a narrower set
#' SearchFacets("liver cancer", organism = "Homo sapiens")
#' }
search_facets <- function(query, ..., structured = FALSE,
                          exclude_ontology = NULL, con = .con()) {
  .need_api(
    con, "search_facets",
    why = "Use {.fn query} to group over the dump with SQL."
  )
  rlang::check_required(query)
  .check_query(query)
  if (!rlang::is_bool(structured)) {
    cli::cli_abort("{.arg structured} must be {.code TRUE} or {.code FALSE}.")
  }
  exclude_ontology <- .check_ontologies(exclude_ontology)

  filters <- .compact(list(...))
  .check_filter_names(filters, .facet_filters, "facet filter")

  res <- do.call(.api_get, c(
    list(con = con, path = "/search/facets", q = query),
    if (structured) list(structured = "true"),
    if (length(exclude_ontology)) list(exclude_ontology = exclude_ontology),
    filters
  ))

  out <- .facets_to_tibble(res$facets)
  attr(out, "total") <- res$total
  attr(out, "max_rank") <- res$max_rank
  out
}

#' One row per facet value
#' @noRd
.facets_to_tibble <- function(facets) {
  .pnt_tibble(
    .labelled(facets, "facet"),
    list(
      facet = .pnt_chr, value = .pnt_chr,
      count = .pnt_num, score = .pnt_num
    )
  )
}

#' The sidebar's own filter set
#'
#' Excludes `assay_*` and `geo_*` because the endpoint would ignore them.
#' @noRd
.facet_filters <- sort(c(
  .shared_filters, "db", "library_source", "year_from", "year_to"
))


#' Suggest spelling corrections for a query
#'
#' @param query Character. The query as it was typed.
#' @inheritParams project
#'
#' @return A tibble of suggestions, empty when the query needs no correction.
#'
#' @seealso [seqout_search()], and [search_facets()] for a query that matched
#'   too much.
#'
#' @export
#' @examples
#' \dontrun{
#' SearchSuggest("livre cancr")
#'
#' # already spelled correctly
#' SearchSuggest("liver cancer")
#' }
search_suggest <- function(query, con = .con()) {
  .need_api(con, "search_suggest")
  rlang::check_required(query)
  .check_query(query)
  res <- .api_get(con, "/search/suggest", q = query)
  suggestions <- res$suggestions
  # empty typed tibble keeps the corrected_query column
  if (length(suggestions) == 0) {
    return(tibble::tibble(corrected_query = character(0), corrections = list()))
  }
  .records_to_tibble(suggestions)
}
