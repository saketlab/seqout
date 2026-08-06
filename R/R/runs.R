#' One sequencing run
#'
#' The run record with its file URLs, sizes and checksums.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession A run accession (SRR, ERR, DRR, CRR, HRR).
#'
#' @return A one-row tibble, or an empty tibble when the run is unknown.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' run(con, "SRR13927092")
#' }
run <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)

  df <- .db_query(
    con,
    "SELECT * FROM run_download_links WHERE run_accession = ? LIMIT 1",
    params = list(accession)
  )
  if (nrow(df) > 0) {
    return(df)
  }

  tryCatch(
    .records_to_tibble(list(.api_get(con, paste0("/run/", accession)))),
    error = function(e) tibble::tibble()
  )
}
