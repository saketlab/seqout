#' Get project metadata
#'
#' @param accession Project accession, e.g. `"GSE1234"`,
#'   `"SRP012345"`, `"E-MTAB-1234"`, `"PRJNA123456"`.
#' @param transpose Return one row per field. A project record is wide.
#' @param con A `seqout_connection`. Defaults to the shared REST connection;
#'   a Parquet connection reads the dump.
#' @return A tibble with project metadata, or a `field`/`value` tibble when
#'   `transpose = TRUE`.
#' @keywords internal
#' @examples
#' \dontrun{
#' project("GSE297547", transpose = TRUE)
#' }
project <- function(accession, transpose = FALSE, con = .con()) {
  .check_connection(con)
  check_required(accession)

  out <- if (identical(con$backend, "parquet")) {
    tbl <- .accession_to_table(accession)
    m <- .table_column_map(tbl)
    .db_query(con, sprintf("SELECT * FROM %s WHERE %s = ?", tbl, m$acc_col),
      params = list(accession)
    )
  } else {
    .records_to_tibble(list(.api_get(con, paste0("/project/", accession))))
  }
  if (transpose) .as_fields(out) else out
}

#' One row per field, for records too wide to print
#'
#' List columns flatten to semicolon-joined strings.
#' @noRd
.as_fields <- function(x) {
  if (nrow(x) == 0) {
    return(tibble::tibble(field = character(0), value = character(0)))
  }
  if (nrow(x) > 1) {
    cli::cli_abort("Only a single-row table can be transposed; got {nrow(x)} rows.")
  }
  tibble::tibble(
    field = names(x),
    value = vapply(x, .flatten_value, character(1), USE.NAMES = FALSE)
  )
}

#' @noRd
.flatten_value <- function(v) {
  if (is.list(v)) {
    v <- unlist(v, use.names = FALSE)
  }
  v <- v[!is.na(v)]
  if (length(v) == 0) {
    return(NA_character_)
  }
  paste(as.character(v), collapse = "; ")
}

#' Get samples for a project
#'
#' @inheritParams project
#' @return A tibble of sample metadata.
#' @keywords internal
project_samples <- function(accession, con = .con()) {
  .check_connection(con)
  check_required(accession)

  row <- .accession_row(accession)
  if (is.null(row) || is.null(row$child)) {
    cli::cli_abort("{.val {accession}} has no sample table.")
  }

  if (identical(con$backend, "api")) {
    path <- switch(row$archive,
      geo = paste0("/geo/series/", accession, "/samples"),
      arrayexpress = paste0("/arrayexpress/experiment/", accession, "/samples"),
      paste0("/project/", accession, "/samples")
    )
    res <- .api_get(con, path)
    return(.records_to_tibble(.as_record_list(res$samples %||% res)))
  }

  if (identical(row$table, "sra_studies")) {
    accession <- .resolve_to_sra_study(con, accession)
  }

  # GEO lacks a series column; samples_ref avoids a sample-table scan
  sql <- if (identical(row$child, "geo_series_samples")) {
    paste(
      "SELECT s.* FROM geo_samples s WHERE s.accession IN",
      "(SELECT unnest(json_extract_string(samples_ref, '$[*]'))",
      "FROM geo_series WHERE accession = ?)"
    )
  } else {
    parts <- strsplit(row$child, "|", fixed = TRUE)[[1]]
    sprintf("SELECT * FROM %s WHERE %s = ?", parts[1], parts[2])
  }

  .db_query(con, sql, params = list(accession))
}

#' Get experiments for a study
#'
#' @param study Character. Study accession (SRP/ERP/DRP/PRJ*).
#' @inheritParams project
#' @return A tibble of experiment metadata.
#' @keywords internal
project_experiments <- function(study, con = .con()) {
  .check_connection(con)
  check_required(study)

  if (identical(con$backend, "api")) {
    res <- .api_get(con, paste0("/project/", study, "/experiments"))
    return(.records_to_tibble(.as_record_list(res$experiments %||% res)))
  }

  resolved <- .resolve_to_sra_study(con, study)
  .db_query(con, "SELECT * FROM sra_experiments WHERE study = ?",
    params = list(resolved)
  )
}

#' Get run download links for a study
#'
#' @param study Character. Study accession.
#' @param full Read every run. The default is the server's 500-run preview.
#'   Downloads require the full list. REST only.
#' @inheritParams project
#' @return A tibble of run metadata with download links.
#' @keywords internal
project_runs <- function(study, full = FALSE, con = .con()) {
  .check_connection(con)
  check_required(study)

  if (identical(con$backend, "parquet")) {
    resolved <- .resolve_to_sra_study(con, study)
    return(.db_query(
      con,
      "SELECT r.* FROM sra_runs r
       WHERE r.experiment IN (SELECT accession FROM sra_experiments WHERE study = ?)",
      params = list(resolved)
    ))
  }

  resp <- .api_get(con, paste0("/project/", study, "/runs"),
    full = if (full) "true"
  )
  .records_to_tibble(resp$runs %||% list())
}

#' Get cross-references for a project
#'
#' REST only; the dump lacks cross-references.
#'
#' @inheritParams project
#' @return A tibble with cross-reference entries.
#' @keywords internal
project_xref <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)
  res <- .api_get(con, paste0("/project/", accession, "/xref"))
  .records_to_tibble(.as_record_list(res$xref %||% res))
}

#' Get the harmonised sample metadata
#'
#' REST only; enrichment is absent from the dump.
#'
#' @inheritParams project
#' @return A tibble with enriched sample metadata (v3 if available, else v1).
#' @keywords internal
project_enriched <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)
  res <- .api_get(
    con, paste0("/project/", accession, "/enriched"),
    null_on = 404L
  )
  .records_to_tibble(.as_record_list(res$samples %||% res))
}

#' Get citations for a project
#'
#' @inheritParams project
#' @param type One of `"original"` or `"all"`.
#' @param format One of `"tibble"` (default) or `"bibtex"`.
#' @return A tibble with citation data, or a character string of BibTeX.
#' @keywords internal
project_citations <- function(accession, type = "original",
                              format = "tibble", con = .con()) {
  .check_connection(con)
  check_required(accession)
  type <- match.arg(type, c("original", "all"))
  format <- match.arg(format, c("tibble", "bibtex"))

  from_api <- function() {
    if (format == "bibtex") {
      # 404 means no linked paper
      return(.api_get_text(con, paste0("/project/", accession, "/cite"),
        type = type, format = "bibtex", null_on = 404L
      ) %||% character(0))
    }
    .records_to_tibble(.as_record_list(
      .api_get(con, paste0("/project/", accession, "/cite"),
        type = type, format = "json"
      )
    ))
  }

  if (identical(con$backend, "parquet")) {
    # BibTeX is API-only; the dump answers tibble form
    if (format == "bibtex") {
      return(from_api())
    }
    # dump lacks study_publications
    return(tryCatch(
      .db_query(con, .publications_sql("WHERE sp.accession = ?"),
        params = list(accession)
      ),
      error = function(e) from_api()
    ))
  }

  from_api()
}

#' @noRd
.accession_to_table <- function(accession) {
  row <- .accession_row(accession)
  if (is.null(row) || is.null(row$table)) {
    cli::cli_abort("Cannot determine table for accession {.val {accession}}")
  }
  row$table
}

#' @noRd
.resolve_to_sra_study <- function(con, study) {
  if (!grepl("^PRJ", study, ignore.case = TRUE)) {
    return(study)
  }

  df <- .db_query(con,
    "SELECT accession FROM sra_studies WHERE accession = ? OR alias = ? LIMIT 1",
    params = list(study, study)
  )
  if (nrow(df) > 0) {
    return(df$accession[1])
  }
  study
}
