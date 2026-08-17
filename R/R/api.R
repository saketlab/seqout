#' @name api-internal
#' @noRd
NULL

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

#' @param null_on Status codes returned as `NULL` instead of aborting. Match on
#'   the code; cli line-wraps a long abort, so matching its wording is unsafe.
#' @noRd
.api_get <- function(con, path, ..., null_on = integer(0)) {
  .check_connection(con)
  resp <- .build_request(con, path) |>
    httr2::req_url_query(..., .multi = "explode") |>
    httr2::req_perform()
  if (httr2::resp_status(resp) %in% null_on) {
    return(NULL)
  }
  .check_resp(resp, path)
  httr2::resp_body_json(resp)
}

#' @noRd
.api_get_text <- function(con, path, ...) {
  .check_connection(con)
  resp <- .build_request(con, path) |>
    httr2::req_url_query(..., .multi = "explode") |>
    httr2::req_perform()
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
    vapply(vals, .flatten_value, character(1))
  })
  names(cols) <- all_names
  tibble::as_tibble(cols)
}

#' Is this value a record rather than a run of values?
#'
#' A list of lists is plainly one, and so is a named list: `attributes_json`
#' arrives as `{"sex": "female", "tissue": "gut"}`, and pasting the values into
#' `female; gut` keeps the answers while throwing away the questions. An
#' unnamed list of scalars is a plain vector and still flattens.
#' @noRd
.is_structured <- function(v) {
  is.list(v) && (any(vapply(v, is.list, logical(1))) || !is.null(names(v)))
}

#' @noRd
.compact <- function(x) {
  x[!vapply(x, is.null, logical(1))]
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

#' Shared SQL for parsing study_publications JSON into structured columns
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

#' A float8 as a string that survives the round trip
#'
#' The keyset is `(rank, accession) < (cursor_rank, cursor_acc)`, so the cursor
#' has to be the server's value *exactly*. Left as a double, httr2 formats it
#' with `getOption("digits")` -- seven significant digits -- and the paging goes
#' subtly wrong in one of two directions: rounded up, the boundary row is
#' returned again on the next page; rounded down, every row between the
#' truncated and the true rank is skipped without trace. 17 significant digits
#' is what an IEEE-754 double needs to round-trip through text.
#' @noRd
.f8 <- function(x) sprintf("%.17g", as.numeric(x))

#' Walk the cursor until the pages or `max_pages` run out
#'
#' The server names the cursor fields `rank`/`accession` for a relevance sort
#' and `sort_value`/`accession` for an explicit `sortby`; the request spells
#' them `cursor_rank`/`cursor_acc`/`cursor_sort`. Reading the response with the
#' request's names silently yields NULL, which re-requests page 1 forever, so
#' the two vocabularies are mapped explicitly here.
#'
#' `max_pages` may be `Inf`, so pages accumulate in a list rather than a
#' preallocated vector.
#' @noRd
.paginate_api <- function(con, path, params, max_pages = 1) {
  pages <- list()
  rows <- 0
  result <- NULL
  # Unbounded searches can otherwise appear to hang between 200-row pages.
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
