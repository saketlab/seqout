#' Bulk metadata download
#'
#' Fetches detailed metadata for multiple accessions from the REST API.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accessions Character vector of accessions (GSE/SRP/ERP/DRP/PRJNA).
#' @param output_dir Directory to save CSV files. If `NULL`, returns a list
#'   of tibbles.
#' @return If `output_dir` is `NULL`, a named list of tibbles. Otherwise,
#'   the paths of written CSV files (invisibly).
#' @export
bulk_metadata <- function(accessions, output_dir = NULL, con = .con()) {
  .check_connection(con)
  check_required(accessions)

  raw <- .api_post(con, "/bulk/metadata",
    body = list(accessions = as.list(accessions)), raw = TRUE
  )

  tmp_zip <- tempfile(fileext = ".zip")
  on.exit(unlink(tmp_zip), add = TRUE)
  writeBin(raw, tmp_zip)

  if (!is.null(output_dir)) {
    dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
    utils::unzip(tmp_zip, exdir = output_dir)
    files <- list.files(output_dir, pattern = "\\.csv$", full.names = TRUE)
    cli::cli_alert_success("Wrote {length(files)} CSV file{?s} to {.path {output_dir}}")
    return(invisible(files))
  }

  tmp_dir <- tempfile()
  on.exit(unlink(tmp_dir, recursive = TRUE), add = TRUE)
  utils::unzip(tmp_zip, exdir = tmp_dir)
  files <- list.files(tmp_dir, pattern = "\\.csv$", full.names = TRUE)
  stats::setNames(
    lapply(files, function(f) tibble::as_tibble(utils::read.csv(f))),
    tools::file_path_sans_ext(basename(files))
  )
}
