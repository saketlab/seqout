#' Get project metadata
#'
#' @param con A `seqout_connection` from [connect_seqout()].
#' @param accession Character. Project accession (e.g., `"GSE1234"`,
#'   `"SRP012345"`, `"E-MTAB-1234"`, `"PRJNA123456"`).
#' @return A tibble with project metadata.
#' @export
sq_project <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  tbl <- .accession_to_table(accession)
  m <- .table_column_map(tbl)
  .db_query(con, sprintf("SELECT * FROM %s WHERE %s = ?", tbl, m$acc_col),
    params = list(accession)
  )
}


#' Get project title and description only
#'
#' @inheritParams sq_project
#' @return A tibble with `accession`, `title`, and `description` columns.
#' @export
sq_project_metadata <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  tbl <- .accession_to_table(accession)
  m <- .table_column_map(tbl)
  .db_query(con, sprintf(
    "SELECT %s AS accession, %s AS title, %s AS description FROM %s WHERE %s = ?",
    m$acc_col, m$title_col, m$desc_col, tbl, m$acc_col
  ), params = list(accession))
}


#' Get samples for a project
#'
#' @inheritParams sq_project
#' @return A tibble of sample metadata.
#' @export
sq_project_samples <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  tbl <- .accession_to_table(accession)

  if (tbl == "sra_studies") {
    # Resolve PRJ* accessions to SRA study accession
    accession <- .resolve_to_sra_study(con, accession)
  }

  sql <- switch(tbl,
    geo_series = "
      SELECT s.* FROM geo_samples s
      WHERE s.accession IN (
        SELECT unnest(samples_ref) FROM geo_series WHERE accession = ?
      )",
    arrayexpress_experiments =
      "SELECT * FROM arrayexpress_samples WHERE experiment_accession = ?",
    ena_studies =
      "SELECT * FROM ena_experiments WHERE study_accession = ?",
    "SELECT * FROM sra_experiments WHERE study = ?"
  )

  .db_query(con, sql, params = list(accession))
}


#' Get experiments for a study
#'
#' @param con A `seqout_connection`.
#' @param study Character. Study accession (SRP/ERP/DRP/PRJ*).
#' @return A tibble of experiment metadata.
#' @export
sq_project_experiments <- function(con, study) {
  .check_connection(con)
  check_required(study)

  resolved <- .resolve_to_sra_study(con, study)
  .db_query(con, "SELECT * FROM sra_experiments WHERE study = ?",
    params = list(resolved)
  )
}


#' Get run download links for a study
#'
#' @param con A `seqout_connection`.
#' @param study Character. Study accession.
#' @return A tibble of run metadata with download links.
#' @export
sq_project_runs <- function(con, study) {
  .check_connection(con)
  check_required(study)
  .records_to_tibble(.api_get(con, paste0("/project/", study, "/runs")))
}


#' Get cross-references for a project
#'
#' @inheritParams sq_project
#' @return A tibble with cross-reference entries.
#' @export
sq_project_xref <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  xref_parts <- list(
    cross_ref_geo = "SELECT 'geo' AS source, geo_accession AS source_accession, target_accession, link_type FROM cross_ref_geo WHERE geo_accession = ? OR target_accession = ?",
    cross_ref_ae  = "SELECT 'ae', ae_accession, target_accession, link_type FROM cross_ref_ae WHERE ae_accession = ? OR target_accession = ?",
    cross_ref_ena = "SELECT 'ena', ena_accession, target_accession, link_type FROM cross_ref_ena WHERE ena_accession = ? OR target_accession = ?"
  )

  available <- names(xref_parts)[names(xref_parts) %in% con$tables]
  if (length(available) == 0) {
    return(tibble::tibble())
  }

  sql <- paste(xref_parts[available], collapse = " UNION ALL ")
  params <- rep(list(accession), length(available) * 2)
  .db_query(con, sql, params = params)
}


#' Get ontology-enriched sample metadata
#'
#' @inheritParams sq_project
#' @return A tibble with enriched sample metadata (v3 if available, else v1).
#' @export
sq_project_enriched <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  df <- .db_query(con, "SELECT * FROM ontology_samples_v3 WHERE study_accession = ?",
    params = list(accession)
  )
  if (nrow(df) > 0) {
    return(df)
  }

  .db_query(con, "SELECT * FROM enriched_samples WHERE study_accession = ?",
    params = list(accession)
  )
}


#' Get citations for a project
#'
#' Uses DuckDB to parse publication data from the `study_publications` table.
#' Falls back to the REST API for BibTeX format.
#'
#' @inheritParams sq_project
#' @param type One of `"original"` or `"all"`.
#' @param format One of `"tibble"` (default) or `"bibtex"`.
#' @return A tibble with citation data, or a character string of BibTeX.
#' @export
sq_project_citations <- function(con, accession, type = "original",
                                 format = "tibble") {
  .check_connection(con)
  check_required(accession)
  type <- match.arg(type, c("original", "all"))
  format <- match.arg(format, c("tibble", "bibtex"))

  if (format == "bibtex") {
    return(.bibtex_from_db(con, accession))
  }

  tryCatch(
    .db_query(con, .publications_sql("WHERE sp.accession = ?"),
      params = list(accession)
    ),
    error = function(e) {
      result <- .api_get(con, paste0("/project/", accession, "/cite"),
        type = type, format = "json"
      )
      .records_to_tibble(result)
    }
  )
}


#' @noRd
.accession_to_table <- function(accession) {
  if (grepl("^GSE", accession, ignore.case = TRUE)) {
    "geo_series"
  } else if (grepl("^ERP", accession, ignore.case = TRUE)) {
    "ena_studies"
  } else if (grepl("^[SD]RP", accession, ignore.case = TRUE)) {
    "sra_studies"
  } else if (grepl("^E-", accession, ignore.case = TRUE)) {
    "arrayexpress_experiments"
  } else if (grepl("^PRJ", accession, ignore.case = TRUE)) {
    "sra_studies"
  } else {
    cli::cli_abort("Cannot determine table for accession {.val {accession}}")
  }
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

  df <- DBI::dbGetQuery(con$db,
    "SELECT accession FROM sra_studies WHERE accession = ? OR alias = ? LIMIT 1",
    params = list(study, study)
  )
  if (nrow(df) > 0) {
    return(df$accession[1])
  }
  study
}
