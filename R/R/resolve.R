#' Find the study an accession belongs to
#'
#' Walks from a child accession (a run, experiment or sample) to the study or
#' series that holds it. DuckDB answers first; the REST API is the fallback for
#' accessions the Parquet dump does not cover.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession A run, experiment or sample accession.
#'
#' @return The study accession, or `NA_character_` when nothing links back.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' resolve_study(con, "SRR13927092")
#' }
resolve_study <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)

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
    found <- gsm_series(con, accession)
    if (!is.na(found)) {
      return(found)
    }
  }

  tryCatch(
    {
      result <- .api_get(con, paste0("/accession/", accession, "/project"))
      result$accession %||% NA_character_
    },
    error = function(e) NA_character_
  )
}

#' Find the GEO series a sample belongs to
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param gsm A GEO sample accession (GSM).
#'
#' @return The GSE accession, or `NA_character_`.
#'
#' @export
gsm_series <- function(con, gsm) {
  .check_connection(con)
  rlang::check_required(gsm)

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
  tryCatch(
    {
      result <- .api_get(con, paste0("/sample-detail/", gsm))
      result$series %||% result$series_ref %||% NA_character_
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
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession A series accession (GSE, E-MTAB-N, E-GEAD-N).
#'
#' @return The linked study accession, or `NA_character_`.
#'
#' @export
linked_study <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)

  xref <- tryCatch(project_xref(con, accession), error = function(e) NULL)
  if (!is.null(xref) && nrow(xref) > 0) {
    hit <- xref[vapply(xref$accession, .in_archive, logical(1), .study_archives), , drop = FALSE]
    if (nrow(hit) > 0) {
      return(hit$accession[1])
    }
  }

  meta <- tryCatch(project_metadata(con, accession), error = function(e) NULL)
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
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession A study accession (SRP, ERP, DRP, PRJ).
#'
#' @return The linked series accession, or `NA_character_`.
#'
#' @export
linked_geo <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)

  xref <- tryCatch(project_xref(con, accession), error = function(e) NULL)
  if (!is.null(xref) && nrow(xref) > 0) {
    hit <- xref[vapply(xref$accession, .in_archive, logical(1), .geo_archives), , drop = FALSE]
    if (nrow(hit) > 0) {
      return(hit$accession[1])
    }
  }
  NA_character_
}
