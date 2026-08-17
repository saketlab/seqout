#' Get project metadata
#'
#' @param accession Character. Project accession (e.g., `"GSE1234"`,
#'   `"SRP012345"`, `"E-MTAB-1234"`, `"PRJNA123456"`).
#' @param transpose Return one row per field instead of one wide row. A project
#'   record runs to 25 columns, which prints unreadably.
#' @param con A `seqout_connection`. Defaults to the shared REST connection;
#'   pass a Parquet one to read the dump instead.
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
#' List columns are flattened to a semicolon-joined string, so the result is
#' always two character columns.
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

  # GEO lacks a series column; `samples_ref` scans the whole sample table.
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
#' @param full Read every run. The default is the server's 500-run preview,
#'   which is enough to inspect a study but not to download one. REST only.
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
#' REST only: the Parquet dump holds no cross-reference table.
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
#' REST only: the enrichment is computed server-side and is not in the dump.
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
      return(.api_get_text(con, paste0("/project/", accession, "/cite"),
        type = type, format = "bibtex"
      ))
    }
    .records_to_tibble(.as_record_list(
      .api_get(con, paste0("/project/", accession, "/cite"),
        type = type, format = "json"
      )
    ))
  }

  if (identical(con$backend, "parquet")) {
    if (format == "bibtex") {
      return(.bibtex_from_db(con, accession))
    }
    # `study_publications` is no longer in the dump.
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
.bibtex_from_db <- function(con, accession) {
  sql <- "
    SELECT
      json_extract_string(j, '$.authors') AS authors,
      json_extract_string(j, '$.title') AS title,
      json_extract_string(j, '$.journal') AS journal,
      json_extract_string(j, '$.pub_date') AS pub_date,
      json_extract_string(j, '$.doi') AS doi,
      json_extract_string(j, '$.pmid') AS pmid
    FROM study_publications sp,
         LATERAL (
           SELECT unnest(from_json(sp.publications, '[\"json\"]'::JSON)) AS j
         )
    WHERE sp.accession = ?
  "

  df <- tryCatch(
    .db_query(con, sql, params = list(accession)),
    error = function(e) {
      return(.api_get_text(con, paste0("/project/", accession, "/cite"),
        type = "original", format = "bibtex"
      ))
    }
  )

  if (is.character(df)) {
    return(df)
  }
  if (nrow(df) == 0) {
    return("")
  }

  entries <- vapply(seq_len(nrow(df)), function(i) {
    r <- df[i, ]
    year <- sub("^(\\d{4}).*", "\\1", r$pub_date %||% "")
    first_author <- sub(",.*", "", sub(" .*", "", r$authors %||% "Unknown"))
    key <- paste0(first_author, year)

    fields <- character()
    if (!is.na(r$authors) && nzchar(r$authors)) {
      fields <- c(fields, sprintf("  author  = {%s}", r$authors))
    }
    if (!is.na(r$title) && nzchar(r$title)) {
      fields <- c(fields, sprintf("  title   = {%s}", r$title))
    }
    if (!is.na(r$journal) && nzchar(r$journal)) {
      fields <- c(fields, sprintf("  journal = {%s}", r$journal))
    }
    if (nzchar(year)) {
      fields <- c(fields, sprintf("  year    = {%s}", year))
    }
    if (!is.na(r$doi) && nzchar(r$doi)) {
      fields <- c(fields, sprintf("  doi     = {%s}", r$doi))
    }
    if (!is.na(r$pmid) && nzchar(r$pmid)) {
      fields <- c(fields, sprintf("  pmid    = {%s}", r$pmid))
    }

    paste0("@article{", key, ",\n", paste(fields, collapse = ",\n"), "\n}")
  }, character(1))

  paste(entries, collapse = "\n\n")
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
