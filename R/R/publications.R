#' Get publications linked to study accessions
#'
#' Parses the JSON publications column from the `study_publications` table
#' using DuckDB's JSON functions.
#'
#' @param con A `seqout_connection`.
#' @param accessions Character vector of study accessions.
#' @return A tibble with publication metadata (accession, source, pmid, title,
#'   journal, doi, citation_count, etc.).
#' @export
sq_publications <- function(con, accessions) {
  .check_connection(con)
  check_required(accessions)

  placeholders <- paste(rep("?", length(accessions)), collapse = ", ")
  where <- sprintf("WHERE sp.accession IN (%s)", placeholders)

  tryCatch(
    .db_query(con, .publications_sql(where), params = as.list(accessions)),
    error = function(e) {
      sql2 <- sprintf(
        "SELECT accession, source, publications FROM study_publications WHERE accession IN (%s)",
        placeholders
      )
      .db_query(con, sql2, params = as.list(accessions))
    }
  )
}


#' Look up common name for a scientific name
#'
#' @param con A `seqout_connection`.
#' @param scientific_name Character. Scientific name to look up.
#' @return A character string with the common name, or `NA` if not found.
#' @export
sq_common_name <- function(con, scientific_name) {
  .check_connection(con)
  check_required(scientific_name)

  df <- .db_query(con,
    "SELECT common_name FROM common_names WHERE scientific_name = ? LIMIT 1",
    params = list(scientific_name)
  )
  if (nrow(df) == 0) {
    return(NA_character_)
  }
  df$common_name[1]
}
