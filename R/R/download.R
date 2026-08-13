#' Download files
#'
#' Fetches a list of URLs into a directory, skipping any file already present.
#' Downloads run in parallel through curl's multi interface.
#'
#' @param urls Character vector of URLs.
#' @param dest_dir Directory to write into. Created when missing.
#' @param overwrite Re-download files that are already present.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the files in `dest_dir`, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' download_files("https://example.org/a.csv.gz", "counts")
#' }
download_files <- function(urls, dest_dir, overwrite = FALSE, quiet = FALSE) {
  rlang::check_required(urls)
  rlang::check_required(dest_dir)
  urls <- unique(urls[!is.na(urls) & nzchar(urls)])
  if (length(urls) == 0) {
    return(invisible(character(0)))
  }
  dir.create(dest_dir, recursive = TRUE, showWarnings = FALSE)

  paths <- file.path(dest_dir, basename(urls))
  missing <- if (overwrite) rep(TRUE, length(urls)) else !file.exists(paths)

  if (any(missing)) {
    if (!quiet) {
      cli::cli_alert_info("Downloading {sum(missing)} file{?s} to {.path {dest_dir}}")
    }
    .curl_download(urls[missing], paths[missing], quiet = quiet)
  }
  invisible(paths)
}

#' Fetch urls to paths, retrying ftp:// over https
#'
#' NCBI serves the same paths both ways. Networks that block outbound port 21
#' are common enough that an ftp:// failure is not the end of the attempt.
#' @noRd
.curl_download <- function(urls, paths, quiet = FALSE) {
  res <- curl::multi_download(urls, paths, resume = TRUE, progress = !quiet)
  failed <- !is.na(res$error)

  retry <- failed & startsWith(urls, "ftp://")
  if (any(retry)) {
    if (!quiet) {
      cli::cli_alert_info("FTP unavailable, retrying {sum(retry)} file{?s} over HTTPS")
    }
    unlink(paths[retry])
    over_https <- sub("^ftp://", "https://", urls[retry])
    again <- curl::multi_download(
      over_https, paths[retry],
      resume = FALSE, progress = !quiet
    )
    failed[retry] <- !is.na(again$error)
    res$error[retry] <- again$error
  }

  if (any(failed)) {
    cli::cli_warn("Download failed for {sum(failed)} file{?s}: {res$error[failed][1]}")
  }
  invisible(paths)
}

#' Download a project's supplementary files
#'
#' The processed files a submitter uploaded: count matrices, annotations and
#' archives.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A project accession.
#' @param dest_dir Directory to write into. Defaults to the accession.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files.
#'
#' @export
download_supplementary <- function(accession, dest_dir = NULL, quiet = FALSE, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)
  if (is.null(dest_dir)) dest_dir <- accession

  urls <- .supplementary_urls(con, accession, sample = FALSE)
  if (length(urls) == 0) {
    cli::cli_alert_warning("{accession} lists no supplementary files.")
    return(invisible(character(0)))
  }
  download_files(urls, dest_dir, quiet = quiet)
}

#' Download the read files of a study
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param study A study accession.
#' @param dest_dir Directory to write into. Defaults to the study accession.
#' @param mode Which copy to take. Not every run offers every mode.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files.
#'
#' @export
download_runs <- function(study, dest_dir = NULL,
                          mode = names(.run_url_columns),
                          quiet = FALSE,
                          con = .con()) {
  .check_connection(con)
  rlang::check_required(study)
  mode <- match.arg(mode)
  if (is.null(dest_dir)) dest_dir <- study

  runs <- project_runs(study, full = TRUE, con = con)
  if (nrow(runs) == 0) {
    cli::cli_alert_warning("{study} has no runs.")
    return(invisible(character(0)))
  }
  column <- .run_url_columns[[mode]]
  if (!column %in% names(runs)) {
    cli::cli_abort(c(
      "The runs of {study} carry no {.val {mode}} URLs.",
      "i" = "Available: {.val {intersect(names(runs), unlist(.run_url_columns))}}"
    ))
  }
  values <- runs[[column]]
  values <- values[!is.na(values) & nzchar(values)]
  urls <- unlist(strsplit(values, ";", fixed = TRUE))
  download_files(urls, dest_dir, quiet = quiet)
}

#' @noRd
.run_url_columns <- list(
  fastq = "fastq_ftp", sra = "sra_ftp", sra_lite = "ncbi_sra_lite_url",
  s3 = "ncbi_sra_lite_s3_url", gcs = "ncbi_sra_lite_gs_url"
)

#' Get a download script for a study
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param study A study accession.
#' @param mode Download source.
#' @param file Optional path to write the script to.
#'
#' @return The script as a character string, invisibly when `file` is given.
#'
#' @export
download_script <- function(study, mode = "fastq", file = NULL, con = .con()) {
  .check_connection(con)
  rlang::check_required(study)
  mode <- match.arg(mode, names(.run_url_columns))

  result <- .api_get_text(con, paste0("/project/", study, "/download/", mode))

  if (!is.null(file)) {
    writeLines(result, file)
    Sys.chmod(file, "0755")
    cli::cli_alert_success("Wrote download script to {.path {file}}")
    return(invisible(result))
  }
  result
}
