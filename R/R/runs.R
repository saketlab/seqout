#' One sequencing run
#'
#' The run record with its file URLs, sizes and checksums.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A run accession (SRR, ERR, DRR, CRR, HRR).
#'
#' @return A one-row tibble, or an empty tibble when the run is unknown.
#'
#' @keywords internal
#' @examples
#' \dontrun{
#' run("SRR13927092")
#' }
run <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  if (identical(con$backend, "parquet")) {
    return(.db_query(
      con,
      "SELECT * FROM run_download_links WHERE run_accession = ? LIMIT 1",
      params = list(accession)
    ))
  }

  tryCatch(
    .records_to_tibble(list(.api_get(con, paste0("/run/", accession)))),
    error = function(e) tibble::tibble()
  )
}
