#' Get publications linked to study accessions
#'
#' Parses the JSON publications column from the `study_publications` table
#' using DuckDB's JSON functions.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accessions Character vector of study accessions.
#' @return A tibble with publication metadata (accession, source, pmid, title,
#'   journal, doi, citation_count, etc.).
#' @keywords internal
publications <- function(accessions, con = .con()) {
  .check_connection(con)
  rlang::check_required(accessions)
  frames <- lapply(accessions, function(acc) {
    res <- tryCatch(.api_get(con, paste0("/project/", acc)), error = function(e) NULL)
    pubs <- res$publications
    if (is.null(pubs) || length(pubs) == 0) {
      return(NULL)
    }
    rows <- .records_to_tibble(pubs)
    if (nrow(rows) == 0) NULL else cbind(accession = acc, rows)
  })
  frames <- Filter(Negate(is.null), frames)
  if (length(frames) == 0) tibble::tibble() else tibble::as_tibble(do.call(rbind, frames))
}
