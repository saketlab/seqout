#' Get detailed sample or experiment metadata
#'
#' Accepts a sample or experiment accession from any archive SeqOut holds. On
#' the Parquet backend the accession prefix picks the table; over REST it is one
#' request either way.
#'
#' @param accession Sample or experiment accession
#'   (GSM/SRX/DRX/ERX/SRS/DRS/ERS/SAM*).
#' @inheritParams project
#' @return A tibble with detailed metadata.
#' @export
#' @examples
#' \dontrun{
#' sample_detail("GSM5677584")
#' }
sample_detail <- function(accession, con = .con()) {
  .check_connection(con)
  check_required(accession)

  if (identical(con$backend, "parquet")) {
    tbl <- if (grepl("^GSM", accession, ignore.case = TRUE)) {
      "geo_samples"
    } else if (grepl("^(SRX|DRX|ERX)", accession, ignore.case = TRUE)) {
      "sra_experiments"
    } else if (grepl("^(SRS|DRS|ERS|SAM)", accession, ignore.case = TRUE)) {
      "sra_samples"
    } else {
      cli::cli_abort("Unknown sample accession format: {.val {accession}}")
    }
    return(.db_query(con, sprintf("SELECT * FROM %s WHERE accession = ?", tbl),
      params = list(accession)
    ))
  }

  result <- .api_get(con, paste0("/sample-detail/", accession))
  .records_to_tibble(
    if (is.list(result) && !is.null(result$accession)) list(result) else result
  )
}


#' Resolve a sample/experiment accession to its parent project
#'
#' @param accession A sample or experiment accession.
#' @inheritParams project
#' @return A character string with the parent project accession, or `NA` if
#'   not found.
#' @export
resolve_accession <- function(accession, con = .con()) {
  resolve_study(accession, con = con)
}
