#' Get detailed sample or experiment metadata
#'
#' Accepts a sample or experiment accession from any archive Seqout holds. On
#' the Parquet backend the accession prefix picks the table; over REST it is one
#' request either way.
#'
#' @param accession Sample or experiment accession
#'   (GSM/SRX/DRX/ERX/SRS/DRS/ERS/SAM*).
#' @inheritParams project
#' @return A tibble with detailed metadata.
#' @keywords internal
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
  # The endpoint answers with an envelope: sample_type, project, sample,
  # experiment, runs. Return the record the accession names; `seqout_get()` reaches
  # the rest. An SRX names its experiment, everything else its sample.
  record <- if (identical(result$sample_type, "sra_experiment")) {
    result$experiment
  } else {
    result$sample %||% result
  }
  .records_to_tibble(list(record))
}

#' One part of the sample-detail envelope, as a tibble
#'
#' The endpoint answers a sample, experiment or biosample with its project,
#' its experiment and its runs alongside the record itself, so a caller that
#' wants the runs of one sample need not resolve the study first.
#' @noRd
.detail_part <- function(con, accession, part) {
  res <- .api_get(con, paste0("/sample-detail/", accession))
  .records_to_tibble(.as_record_list(res[[part]]))
}
