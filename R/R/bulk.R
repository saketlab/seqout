#' Bulk project metadata
#'
#' Retrieve accession, title, and description for multiple projects.
#'
#' @param con A `seqout_connection`.
#' @param accessions Character vector of project accessions.
#' @return A tibble with project metadata.
#' @export
bulk_project_metadata <- function(con, accessions) {
  .check_connection(con)
  check_required(accessions)

  if (length(accessions) <= 20) {
    tbl_map <- vapply(accessions, .accession_to_table, character(1))
    groups <- split(accessions, tbl_map)

    results <- lapply(names(groups), function(tbl) {
      accs <- groups[[tbl]]
      m <- .table_column_map(tbl)
      placeholders <- paste(rep("?", length(accs)), collapse = ", ")
      sql <- sprintf(
        "SELECT %s AS accession, %s AS title, %s AS description FROM %s WHERE %s IN (%s)",
        m$acc_col, m$title_col, m$desc_col, tbl, m$acc_col, placeholders
      )
      .db_query(con, sql, params = as.list(accs))
    })
    results <- Filter(function(df) nrow(df) > 0, results)

    if (length(results) == 0) {
      return(tibble::tibble())
    }
    return(tibble::as_tibble(do.call(rbind, results)))
  }

  .records_to_tibble(.api_post(con, "/bulk/project-metadata",
    body = list(accessions = accessions)
  ))
}


#' Bulk metadata download
#'
#' Fetches detailed metadata for multiple accessions from the REST API.
#'
#' @param con A `seqout_connection`.
#' @param accessions Character vector of accessions (GSE/SRP/ERP/DRP/PRJNA).
#' @param output_dir Directory to save CSV files. If `NULL`, returns a list
#'   of tibbles.
#' @return If `output_dir` is `NULL`, a named list of tibbles. Otherwise,
#'   the paths of written CSV files (invisibly).
#' @export
bulk_metadata <- function(con, accessions, output_dir = NULL) {
  .check_connection(con)
  check_required(accessions)

  raw <- .api_post(con, "/bulk/metadata",
    body = list(accessions = accessions), raw = TRUE
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
