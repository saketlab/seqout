#' @name api-internal
#' @noRd
NULL

#' Reject unknown query parameters
#'
#' The server would ignore them and return an unfiltered result.
#' @noRd
.check_query_params <- function(given, accepts, what) {
  bad <- setdiff(given, accepts)
  if (!length(bad)) {
    return(invisible(NULL))
  }
  near <- accepts[colSums(utils::adist(bad, accepts, ignore.case = TRUE) <= 2) > 0]
  cli::cli_abort(c(
    "{.arg {bad}} {?is/are} not a parameter of {.val {what}}.",
    i = if (length(near)) "Did you mean {.arg {near}}?",
    i = "The server ignores a parameter it does not know rather than refusing
         it, so this call would have returned an unfiltered result.",
    i = "Accepted: {.arg {accepts}}."
  ))
}

#' Build a base httr2 request with shared config
#' @noRd
.build_request <- function(con, path, timeout = 60) {
  httr2::request(con$api_url) |>
    httr2::req_url_path_append(path) |>
    httr2::req_headers(`User-Agent` = .user_agent()) |>
    httr2::req_timeout(timeout) |>
    httr2::req_retry(max_tries = 3, backoff = ~2) |>
    httr2::req_error(is_error = function(resp) FALSE)
}

#' @param null_on Status codes that return `NULL`.
#' @param .accepts Query parameters accepted by this endpoint.
#' @noRd
.api_get <- function(con, path, ..., null_on = integer(0), .accepts = NULL) {
  .check_connection(con)
  params <- list(...)
  if (!is.null(.accepts)) {
    .check_query_params(names(.compact(params)), .accepts, path)
  }
  resp <- .build_request(con, path) |>
    httr2::req_url_query(!!!params, .multi = "explode") |>
    httr2::req_perform()
  if (httr2::resp_status(resp) %in% null_on) {
    return(NULL)
  }
  .check_resp(resp, path)
  httr2::resp_body_json(resp)
}

#' @inheritParams .api_get
#' @noRd
.api_get_text <- function(con, path, ..., null_on = integer(0)) {
  .check_connection(con)
  resp <- .build_request(con, path) |>
    httr2::req_url_query(..., .multi = "explode") |>
    httr2::req_perform()
  if (httr2::resp_status(resp) %in% null_on) {
    return(NULL)
  }
  .check_resp(resp, path)
  httr2::resp_body_string(resp)
}

#' @noRd
.api_post <- function(con, path, body, raw = FALSE) {
  .check_connection(con)
  resp <- .build_request(con, path, timeout = 120) |>
    httr2::req_body_json(body) |>
    httr2::req_perform()
  .check_resp(resp, path)
  if (raw) {
    return(httr2::resp_body_raw(resp))
  }
  httr2::resp_body_json(resp)
}

#' @noRd
.check_resp <- function(resp, path) {
  status <- httr2::resp_status(resp)
  if (status >= 400) {
    body <- tryCatch(
      httr2::resp_body_json(resp),
      error = function(e) list(detail = paste("HTTP", status))
    )
    msg <- body$detail %||% paste("HTTP error", status)
    cli::cli_abort("API error on {.path {path}}: {msg}")
  }
}

#' @noRd
.user_agent <- local({
  ua <- NULL
  function() {
    if (is.null(ua)) {
      version <- utils::packageVersion("seqout")
      r_version <- paste0(R.version$major, ".", R.version$minor)
      ua <<- paste0("seqout-r/", version, " R/", r_version)
    }
    ua
  }
})

#' @noRd
.db_query <- function(con, sql, params = NULL) {
  db <- .duckdb(con)
  .ensure_views(con, sql)
  if (!is.null(params)) {
    df <- DBI::dbGetQuery(db, sql, params = params)
  } else {
    df <- DBI::dbGetQuery(db, sql)
  }
  tibble::as_tibble(df)
}

#' @noRd
.records_to_tibble <- function(records) {
  if (length(records) == 0) {
    return(tibble::tibble())
  }
  all_names <- unique(unlist(lapply(records, names)))
  cols <- lapply(all_names, function(nm) {
    vals <- lapply(records, function(r) r[[nm]])
    if (any(vapply(vals, .is_structured, logical(1)))) {
      return(vals)
    }
    flat <- vapply(vals, .flatten_value, character(1))
    if (nm %in% .lgl_columns) as.logical(flat) else flat
  })
  names(cols) <- all_names
  tibble::as_tibble(cols)
}

#' JSON boolean columns
#'
#' String `"FALSE"` is truthy in R, so these columns are cast back.
#' @noRd
.lgl_columns <- c(
  "is_single_cell", "has_enriched", "multi_platform", "any_unfiltered",
  "counted_matrix", "barcode_whitelist_hit", "r1_length_single_cell",
  "has_long_read"
)

#' Whether a value is a record
#'
#' Named lists are records; flattening `attributes_json` would drop its keys.
#' Unnamed scalar lists flatten as vectors.
#' @noRd
.is_structured <- function(v) {
  is.list(v) && (any(vapply(v, is.list, logical(1))) || !is.null(names(v)))
}

#' @noRd
.compact <- function(x) {
  x[!vapply(x, is.null, logical(1))]
}

#' Convert logical filter values to the lowercase strings
#'
#' httr2 sends a bare logical as TRUE/FALSE; the server wants lowercase.
#' @noRd
.lower_bools <- function(x) {
  lapply(x, function(v) if (is.logical(v)) tolower(as.character(v)) else v)
}

#' @noRd
.table_column_map <- function(tbl) {
  for (row in .accession_registry) {
    if (identical(row$table, tbl)) {
      return(list(acc_col = row$cols[1], title_col = row$cols[2], desc_col = row$cols[3]))
    }
  }
  list(acc_col = "accession", title_col = "title", desc_col = "abstract")
}

#' SQL for parsing study_publications JSON
#' @param where_clause SQL WHERE clause (must include "sp." table alias).
#' @noRd
.publications_sql <- function(where_clause) {
  sprintf("
    SELECT
      sp.accession,
      sp.source,
      json_extract_string(j, '$.doi') AS doi,
      json_extract_string(j, '$.title') AS pub_title,
      json_extract_string(j, '$.journal') AS journal,
      json_extract_string(j, '$.pmid') AS pmid,
      CAST(json_extract(j, '$.citation_count') AS INTEGER) AS citation_count
    FROM study_publications sp,
         LATERAL (
           SELECT unnest(from_json(sp.publications, '[\"json\"]'::JSON)) AS j
         )
    %s
  ", where_clause)
}

#' @noRd
.valid_dbs <- c("geo", "sra", "arrayexpress", "ena")

#' Round-trip float8 cursor text
#'
#' The keyset cursor must preserve rank exactly; rounding repeats or skips rows.
#' IEEE-754 doubles need 17 significant digits to survive text.
#' @noRd
.f8 <- function(x) sprintf("%.17g", as.numeric(x))

#' Walk the cursor until pages or `max_pages` run out
#'
#' Response cursors use `rank` or `sort_value`; requests use `cursor_*`.
#' Explicit mapping prevents page 1 loops.
#'
#' `max_pages` may be `Inf`, so pages accumulate in a list.
#' @noRd
.paginate_api <- function(con, path, params, max_pages = 1) {
  pages <- list()
  rows <- 0
  result <- NULL
  # unbounded searches can look idle between 200-row pages
  progress <- interactive() && max_pages > 1
  if (progress) {
    cli::cli_progress_bar(
      format = "Fetching results {cli::pb_spin} {rows} so far",
      clear = TRUE
    )
  }

  repeat {
    result <- do.call(.api_get, c(list(con = con, path = path), params))
    pages[[length(pages) + 1]] <- result$results
    rows <- rows + length(result$results)
    if (progress) cli::cli_progress_update()

    nc <- result$next_cursor
    if (is.null(nc) || length(result$results) == 0 || length(pages) >= max_pages) {
      break
    }

    params$cursor_acc <- nc$accession
    if (!is.null(nc$sort_value)) {
      params$cursor_sort <- nc$sort_value
    } else {
      params$cursor_rank <- .f8(nc$rank)
    }
  }

  if (progress) cli::cli_progress_done()
  out <- .records_to_tibble(unlist(pages, recursive = FALSE))
  attr(out, "total") <- result$total
  attr(out, "took_ms") <- result$took_ms
  out
}


#' Unwrap the shapes the API uses for a list of records
#' @noRd
.as_record_list <- function(records) {
  if (is.null(records)) {
    return(list())
  }
  for (key in c("results", "items", "organisms", "data")) {
    if (!is.null(records[[key]])) {
      return(records[[key]])
    }
  }
  if (!is.null(names(records))) list(records) else records
}

#' 200-row page cap shared by every collection endpoint.
#' @noRd
.collection_page <- 200L

#' Walk a collection `/projects` listing into a tibble
#'
#' Pages by `offset`, or by keyset (`next_cursor` into
#' `cursor_sort`/`cursor_acc`) when `keyset` is `TRUE`. A walk stopped early
#' by `limit` cannot be resumed.
#'
#' @param path API path, with any path parameters already substituted.
#' @param params Named list of filter/sort query parameters (no paging ones).
#' @param spec Column spec passed to `.pnt_tibble()`.
#' @param limit Maximum rows to collect; `NULL` reads every page.
#' @param offset Rows to skip before the first page; offset paging only.
#' @param keep Optional row predicate for a filter the server lacks.
#' @return A tibble with a `total` attribute.
#' @noRd
.walk_pages <- function(con, path, params, spec, limit, offset = 0,
                        keyset = FALSE, keep = NULL) {
  pages <- list()
  kept <- 0L
  total <- 0L
  at <- if (keyset) list(cursor_sort = NULL, cursor_acc = NULL) else list(offset = offset)
  # results arrive in sort order, so later pages can't outrank kept rows
  while (is.null(limit) || kept < limit) {
    # a local filter makes the kept count unknown, so read whole pages
    want <- .collection_page
    if (!is.null(limit) && is.null(keep)) want <- min(limit - kept, .collection_page)
    res <- do.call(.api_get, c(
      list(con = con, path = path), params, list(limit = want), at
    ))
    total <- res$total %||% 0L
    rows <- .as_record_list(res$results)
    got <- length(rows)
    if (!is.null(keep)) rows <- Filter(keep, rows)
    if (length(rows)) {
      pages[[length(pages) + 1L]] <- rows
      kept <- kept + length(rows)
    }
    if (keyset) {
      nc <- res$next_cursor
      # a page with rows but no cursor, or an empty page, both end the walk
      if (is.null(nc) || got == 0) break
      at <- list(cursor_sort = nc$sort_value, cursor_acc = nc$accession)
    } else {
      at$offset <- at$offset + got
      # a stale total would otherwise page forever
      if (got == 0 || at$offset >= total) break
    }
  }
  records <- unlist(pages, recursive = FALSE, use.names = FALSE) %||% list()
  if (!is.null(limit) && length(records) > limit) records <- records[seq_len(limit)]
  out <- .pnt_tibble(records, spec)
  attr(out, "total") <- total
  out
}

#' Fetch a `{facet, value, studies}` table from a fixed `/facets` path
#'
#' For any `/facets` endpoint returning one `{value, studies}` pair per facet
#' name. Callers run their own `.need_api()`/`check_required()`; error
#' messages differ per endpoint.
#'
#' @param path API path, with any path parameters already substituted.
#' @return A tibble with `facet`, `value` and `studies` columns.
#' @noRd
.simple_facets <- function(con, path) {
  res <- .api_get(con, path)
  .pnt_tibble(
    .labelled(res, "facet"),
    list(facet = .pnt_chr, value = .pnt_chr, studies = .pnt_int)
  )
}

#' Fetch a collection's one-row `/summary` as a tibble
#'
#' Callers run their own `.need_api()` first, as for `.simple_facets()`.
#'
#' @param path API path, with any path parameters already substituted.
#' @param spec Column spec for `.pnt_tibble()`.
#' @noRd
.simple_summary <- function(con, path, spec) {
  .pnt_tibble(list(.api_get(con, path)), spec)
}

#' Shared row shape for a single-cell study with population-specific evidence
#'
#' Core columns of `.pert_project_spec()` and `.spt_project_spec()`; each
#' appends its own evidence columns.
#' @noRd
.sc_evidence_project_spec <- function() {
  list(
    study_accession = .pnt_chr, title = .pnt_chr, organism = .pnt_chr,
    organisms = .pnt_list, tissues = .pnt_list,
    single_cell_modality = .pnt_chr, is_long_read = .pnt_lgl, assay_l1 = .pnt_chr,
    readout_assays = .pnt_list, cell_lines = .pnt_list, sample_types = .pnt_list,
    n_samples = .pnt_int, n_cells = .pnt_num,
    has_matrix = .pnt_lgl, has_fastq = .pnt_lgl, has_sra = .pnt_lgl,
    n_fastq_runs = .pnt_int, n_runs = .pnt_int,
    data_availability = .pnt_chr
  )
}
