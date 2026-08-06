#' Get SRA/ENA sample metadata
#'
#' @param con A `seqout_connection`.
#' @param accession Sample accession (SRS/DRS/ERS/SAM*/GSM*).
#' @return A tibble with sample metadata.
#' @export
seqout_sample <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  if (grepl("^(SRS|DRS|ERS|SAM)", accession, ignore.case = TRUE)) {
    sql <- "SELECT * FROM sra_samples WHERE accession = ?"
  } else if (grepl("^GSM", accession, ignore.case = TRUE)) {
    sql <- "SELECT * FROM geo_samples WHERE accession = ?"
  } else {
    cli::cli_abort("Unknown sample accession format: {.val {accession}}")
  }

  .db_query(con, sql, params = list(accession))
}


#' Get detailed sample or experiment metadata
#'
#' Returns full metadata for a sample or experiment accession. Uses DuckDB
#' lookups across the relevant tables based on accession prefix.
#'
#' @param con A `seqout_connection`.
#' @param accession Sample or experiment accession (GSM/SRX/DRX/ERX/SRS/DRS/ERS/SAM*).
#' @return A tibble with detailed metadata.
#' @export
sample_detail <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  if (grepl("^GSM", accession, ignore.case = TRUE)) {
    return(.db_query(con, "SELECT * FROM geo_samples WHERE accession = ?",
      params = list(accession)
    ))
  }
  if (grepl("^(SRX|DRX|ERX)", accession, ignore.case = TRUE)) {
    return(.db_query(con, "SELECT * FROM sra_experiments WHERE accession = ?",
      params = list(accession)
    ))
  }
  if (grepl("^(SRS|DRS|ERS|SAM)", accession, ignore.case = TRUE)) {
    return(.db_query(con, "SELECT * FROM sra_samples WHERE accession = ?",
      params = list(accession)
    ))
  }

  result <- .api_get(con, paste0("/sample-detail/", accession))
  .records_to_tibble(if (is.list(result) && !is.null(result$accession)) list(result) else result)
}


#' Resolve a sample/experiment accession to its parent project
#'
#' Uses DuckDB lookups to find the parent study for a given sample or experiment
#' accession. Falls back to the REST API if not found locally.
#'
#' @param con A `seqout_connection`.
#' @param accession A sample or experiment accession.
#' @return A character string with the parent project accession, or `NA` if
#'   not found.
#' @export
resolve_accession <- function(con, accession) {
  resolve_study(con, accession)
}
