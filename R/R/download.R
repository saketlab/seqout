#' Get a download script for a study
#'
#' @param con A `seqout_connection`.
#' @param study Character. Study accession.
#' @param mode Download source: `"fastq"`, `"sra"`, `"sra_lite"`, `"s3"`,
#'   or `"gcs"`.
#' @param file Optional file path to write the script to.
#' @return The script as a character string (invisibly if `file` is provided).
#' @export
sq_download_script <- function(con, study, mode = "fastq", file = NULL) {
  .check_connection(con)
  check_required(study)
  mode <- match.arg(mode, .valid_download_modes)

  result <- .api_get_text(con, paste0("/project/", study, "/download/", mode))

  if (!is.null(file)) {
    writeLines(result, file)
    Sys.chmod(file, "0755")
    cli::cli_alert_success("Wrote download script to {.path {file}}")
    return(invisible(result))
  }

  result
}


#' Get FASTQ download links for a study
#'
#' @param con A `seqout_connection`.
#' @param study Character. Study accession.
#' @return A tibble with run accessions and FASTQ download URLs.
#' @seealso [sq_project_runs()]
#' @export
sq_fastq_links <- function(con, study) {
  sq_project_runs(con, study)
}
