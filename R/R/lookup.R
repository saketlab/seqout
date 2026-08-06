#' Find a publication and the projects linked to it
#'
#' The reverse lookup: from a paper to the datasets that name it.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param pmid A PubMed ID.
#' @param doi A DOI. Give one of `pmid` or `doi`.
#'
#' @return A tibble of linked projects, empty when the publication is unknown.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' paper(con, pmid = "34764296")
#' }
paper <- function(con, pmid = NULL, doi = NULL) {
  .check_connection(con)
  if (is.null(pmid) && is.null(doi)) {
    cli::cli_abort("Give one of {.arg pmid} or {.arg doi}.")
  }
  res <- tryCatch(
    .api_get(con, "/publication", pmid = pmid, doi = doi),
    error = function(e) NULL
  )
  .records_to_tibble(.as_record_list(res$projects %||% res))
}


#' Datasets linked to an author
#'
#' Every dataset an author is linked to through its publications.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param name The author name as it appears in the publication record.
#' @param limit Maximum datasets to return.
#'
#' @return A tibble of projects.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' author(con, "Aviv Regev")
#' }
author <- function(con, name, limit = 200) {
  .check_connection(con)
  rlang::check_required(name)
  res <- .api_get(con, "/author/projects", q = name, limit = limit)
  .records_to_tibble(.as_record_list(res))
}


#' What an accession is, asked of the server
#'
#' [accession_kind()] answers offline from the shape alone; this asks the
#' backend, which also names the source that holds it.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession Any accession.
#'
#' @return A one-row tibble.
#'
#' @export
classify <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)
  res <- .api_get(con, paste0("/accession/", accession, "/classify"))
  .records_to_tibble(list(res))
}


#' Short project records for many accessions
#'
#' One request for many projects, rather than one request each.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accessions A character vector of project accessions.
#'
#' @return A tibble, one row per project.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' summaries(con, c("GSE168652", "GSE100379"))
#' }
summaries <- function(con, accessions) {
  .check_connection(con)
  rlang::check_required(accessions)
  res <- .api_post(con, "/bulk/project-metadata", list(accessions = as.list(accessions)))
  .records_to_tibble(.as_record_list(res))
}


#' A short project record
#'
#' Title, organisms, dates and counts, without the supplementary file list.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession A project accession.
#'
#' @return A one-row tibble.
#'
#' @export
project_summary <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)
  res <- .api_get(con, paste0("/project/", accession, "/metadata"))
  .records_to_tibble(list(res))
}


#' The runs of one experiment
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession An experiment accession (SRX, ERX, DRX, CRX, HRX).
#'
#' @return A tibble of runs.
#'
#' @export
experiment_runs <- function(con, accession) {
  .check_connection(con)
  rlang::check_required(accession)
  res <- .api_get(con, paste0("/experiment/", accession, "/runs"))
  .records_to_tibble(.as_record_list(res$runs %||% res))
}
