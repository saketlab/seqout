#' Find the study an accession belongs to
#'
#' Walks from a child accession (a run, experiment or sample) to the study or
#' series that holds it.
#'
#' @param accession A run, experiment or sample accession.
#' @inheritParams project
#'
#' @return The study accession, or `NA_character_` when nothing links back.
#'
#' @keywords internal
#' @examples
#' \dontrun{
#' resolve_study("SRR13927092")
#' }
resolve_study <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  if (identical(con$backend, "parquet")) {
    if (grepl("^(SRX|DRX|ERX)", accession, ignore.case = TRUE)) {
      df <- .db_query(
        con, "SELECT study FROM sra_experiments WHERE accession = ? LIMIT 1",
        params = list(accession)
      )
      if (nrow(df) > 0) {
        return(df$study[1])
      }
    }
    if (grepl("^(SRR|DRR|ERR)", accession, ignore.case = TRUE)) {
      df <- .db_query(
        con,
        "SELECT study FROM sra_experiments WHERE accession IN (
           SELECT experiment FROM sra_experiments WHERE accession = ?
         ) LIMIT 1",
        params = list(accession)
      )
      if (nrow(df) > 0) {
        return(df$study[1])
      }
    }
    if (grepl("^GSM", accession, ignore.case = TRUE)) {
      found <- gsm_series(accession, con = con)
      if (!is.na(found)) {
        return(found)
      }
    }
  }

  .rest_study(con, accession)
}

#' Resolve a child accession to its study over REST
#'
#' No single endpoint answers this for every archive, so the exact lookup comes
#' first, chosen by what the accession names, and full-text search is the last
#' resort. `/accession/{acc}/project` only accepts samples and experiments, so
#' a run has to go through its own record.
#' @noRd
.rest_study <- function(con, accession) {
  up <- toupper(accession)
  if (.accession_kind_is(up, .root_entities)) {
    return(accession)
  }

  found <- if (grepl("^([SED]RR|CRR|HRR)", up)) {
    r <- .quiet_api(con, paste0("/run/", accession))
    r$study_accession %||% r$study %||% NULL
  } else if (grepl("^([SED]RX|CRX|HRX)", up)) {
    # GSA answers on sample-detail; SRA and DDBJ only through one of its runs.
    from_detail <- .project_of_sample(con, accession)
    if (!is.null(from_detail)) {
      from_detail
    } else {
      runs <- .quiet_api(con, paste0("/experiment/", accession, "/runs"))
      first <- .as_record_list(runs$runs %||% runs)[[1]]
      if (is.null(first)) NULL else .rest_study(con, first$run_accession %||% first$accession)
    }
  } else {
    .project_of_sample(con, accession)
  }

  if (is.null(found) || is.na(found) || !nzchar(found)) {
    found <- .study_by_search(con, accession)
  }
  found %||% NA_character_
}

#' @noRd
.accession_kind_is <- function(accession, entities) {
  row <- .accession_row(accession)
  !is.null(row) && row$entity %in% entities
}

#' @noRd
.quiet_api <- function(con, path, ...) {
  tryCatch(.api_get(con, path, ...), error = function(e) NULL)
}

#' @noRd
.project_of_sample <- function(con, accession) {
  res <- .quiet_api(con, paste0("/accession/", accession, "/project"))
  acc <- res$accession %||% NULL
  if (is.null(acc) || !nzchar(acc)) NULL else acc
}

#' Last resort: works only when the accession is full-text indexed
#' @noRd
.study_by_search <- function(con, accession) {
  res <- .quiet_api(con, "/search", q = accession)
  hits <- .as_record_list(res$results %||% list())
  for (h in hits) {
    acc <- h$accession %||% ""
    if (nzchar(acc) && .accession_kind_is(toupper(acc), .root_entities)) {
      return(acc)
    }
  }
  NULL
}

#' Find the GEO series a sample belongs to
#'
#' @param gsm A GEO sample accession (GSM).
#' @inheritParams project
#'
#' @return The GSE accession, or `NA_character_`.
#'
#' @keywords internal
gsm_series <- function(gsm, con = .con()) {
  .check_connection(con)
  rlang::check_required(gsm)

  if (identical(con$backend, "parquet")) {
    df <- .db_query(
      con,
      paste(
        "SELECT accession FROM geo_series",
        "WHERE json_contains(samples_ref, to_json(?::VARCHAR)) LIMIT 1"
      ),
      params = list(gsm)
    )
    if (nrow(df) > 0) {
      return(df$accession[1])
    }
  }

  tryCatch(
    {
      result <- .api_get(con, paste0("/sample-detail/", gsm))
      # The detail envelope names the series `project_accession`.
      result$project_accession %||% result$series %||% result$series_ref %||%
        NA_character_
    },
    error = function(e) NA_character_
  )
}

#' Find the sequencing study linked to a series
#'
#' A GEO or ArrayExpress series holds no runs of its own; they belong to a study
#' in a sequence archive. This follows that link, however the archive files it:
#' a cross-reference for GEO and ArrayExpress, the BioProject for GEA.
#'
#' @param accession A series accession (GSE, E-MTAB-N, E-GEAD-N).
#' @inheritParams project
#'
#' @return The linked study accession, or `NA_character_`.
#'
#' @keywords internal
linked_study <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  xref <- tryCatch(project_xref(accession, con = con), error = function(e) NULL)
  if (!is.null(xref) && nrow(xref) > 0) {
    hit <- xref[vapply(xref$accession, .in_archive, logical(1), .study_archives), , drop = FALSE]
    if (nrow(hit) > 0) {
      return(hit$accession[1])
    }
  }

  meta <- tryCatch(project(accession, con = con), error = function(e) NULL)
  bioproject <- meta$bioproject
  if (length(bioproject) > 0 && !is.na(bioproject[1])) {
    return(bioproject[1])
  }
  NA_character_
}

#' Find the series holding the processed files
#'
#' The mirror of [linked_study()]: from a sequencing study to the GEO or
#' ArrayExpress series that carries its supplementary files.
#'
#' @param accession A study accession (SRP, ERP, DRP, PRJ).
#' @inheritParams project
#'
#' @return The linked series accession, or `NA_character_`.
#'
#' @keywords internal
linked_geo <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  xref <- tryCatch(project_xref(accession, con = con), error = function(e) NULL)
  if (!is.null(xref) && nrow(xref) > 0) {
    hit <- xref[vapply(xref$accession, .in_archive, logical(1), .geo_archives), , drop = FALSE]
    if (nrow(hit) > 0) {
      return(hit$accession[1])
    }
  }
  NA_character_
}
