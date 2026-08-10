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

#' @noRd
.api_get <- function(con, path, ...) {
  .check_connection(con)
  resp <- .build_request(con, path) |>
    httr2::req_url_query(..., .multi = "explode") |>
    httr2::req_perform()
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
    nested <- vapply(
      vals,
      function(v) is.list(v) && any(vapply(v, is.list, logical(1))),
      logical(1)
    )
    if (any(nested)) {
      return(vals)
    }
    vapply(vals, .flatten_value, character(1))
  })
  names(cols) <- all_names
  tibble::as_tibble(cols)
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

#' @noRd

#' @noRd
.paginate_api <- function(con, path, params, max_pages = 1) {
  pages <- vector("list", max_pages)
  page <- 0
  result <- NULL

  repeat {
    result <- do.call(.api_get, c(list(con = con, path = path), params))
    page <- page + 1
    pages[[page]] <- result$results

    nc <- result$next_cursor
    if (is.null(nc) || page >= max_pages) break

    params$cursor_rank <- nc$cursor_rank
    params$cursor_acc <- nc$cursor_acc
    if (!is.null(nc$cursor_sort)) params$cursor_sort <- nc$cursor_sort
  }

  all_results <- unlist(pages[seq_len(page)], recursive = FALSE)
  out <- .records_to_tibble(all_results)
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
