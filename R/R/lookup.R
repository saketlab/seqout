#' Find projects linked to a publication
#'
#' @param id Bare PubMed ID (digits) or DOI starting `10.`. URLs error.
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param pmid PubMed ID.
#' @param doi DOI.
#'
#' @return A tibble of linked projects, empty when the publication is unknown.
#'
#' @export
#' @examples
#' \dontrun{
#' Paper("34764296")
#' Paper(doi = "10.1038/s41467-021-26864-x")
#' }
paper <- function(id = NULL, pmid = NULL, doi = NULL, con = .con()) {
  .check_connection(con)
  if (!is.null(id)) {
    if (!is.null(pmid) || !is.null(doi)) {
      cli::cli_abort("Give {.arg id} or {.arg pmid}/{.arg doi}, not both.")
    }
    if (length(id) != 1L || is.na(id) || !(is.character(id) || is.numeric(id))) {
      cli::cli_abort("{.arg id} must be one PubMed ID or DOI.")
    }
    id <- as.character(id)
    # bare PubMed IDs are digits; bare DOIs start 10.
    if (grepl("^10\\.", id)) {
      doi <- id
    } else if (grepl("^[0-9]+$", id)) {
      pmid <- id
    } else {
      cli::cli_abort(c(
        "{.arg id} is neither a PubMed ID nor a DOI.",
        i = "A PubMed ID is digits; a DOI starts with {.val 10.}.",
        i = "Pass {.arg pmid} or {.arg doi} to say which it is."
      ))
    }
  }
  if (is.null(pmid) && is.null(doi)) {
    cli::cli_abort("Give {.arg id}, {.arg pmid} or {.arg doi}.")
  }
  res <- tryCatch(
    .api_get(con, "/publication", pmid = pmid, doi = doi),
    error = function(e) NULL
  )
  .records_to_tibble(.as_record_list(res$projects %||% res))
}


#' Datasets linked to an author
#'
#' Datasets named by an author's publications.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param name The author name as it appears in the publication record.
#' @param limit Maximum datasets to return.
#'
#' @return A tibble of projects.
#'
#' @export
#' @examples
#' \dontrun{
#' Author("Aviv Regev")
#' }
author <- function(name, limit = 200, con = .con()) {
  .check_connection(con)
  rlang::check_required(name)
  res <- .api_get(con, "/author/projects", q = name, limit = limit)
  .records_to_tibble(.as_record_list(res))
}


#' BibTeX for the papers behind a dataset
#'
#' Assembles entries from the dataset publication record.
#' `type = "all"` includes reanalysis papers.
#'
#' A dataset with no linked paper returns `character(0)`.
#'
#' Reads REST. The dump lacks reanalysis papers and often publication dates.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A project accession, or several. Several return one
#'   bibliography, each entry named for the dataset it came from.
#' @param type `"original"`, the default, or `"all"`.
#'
#' @return A character string of BibTeX entries, or `character(0)`.
#'
#' @seealso `seqout_get(x)$pubs` for the same papers as a tibble, and [paper()]
#'   to go the other way, from a paper to the datasets.
#'
#' @export
#' @examples
#' \dontrun{
#' cat(Citations("GSE151530"))
#'
#' # include reanalysis papers
#' cat(Citations("GSE168652", type = "all"))
#'
#' writeLines(Citations("GSE151530"), "GSE151530.bib")
#' }
citations <- function(accession, type = "original", con = .con()) {
  .need_api(
    con, "citations",
    why = "The dump has no reanalysis papers and often no publication date."
  )
  rlang::check_required(accession)
  type <- match.arg(type, c("original", "all"))
  if (length(accession) == 1L) {
    return(project_citations(accession, type = type, format = "bibtex", con = con))
  }
  # one bibliography over several datasets, each entry named for its source
  each <- lapply(accession, function(a) {
    project_citations(a, type = type, format = "bibtex", con = con)
  })
  stats::setNames(unlist(each, use.names = FALSE), rep(accession, lengths(each)))
}


#' Short project records for many accessions
#'
#' Batches project lookup.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accessions A character vector of project accessions.
#'
#' @return A tibble, one row per project.
#'
#' @export
#' @examples
#' \dontrun{
#' Summaries(c("GSE168652", "GSE100379"))
#' }
summaries <- function(accessions, con = .con()) {
  .check_connection(con)
  rlang::check_required(accessions)

  # a BioProject has no record of its own; names keep the asked-for accession
  resolved <- vapply(accessions, function(a) .prj_study(con, a), character(1))

  out <- if (identical(con$backend, "parquet")) {
    .summaries_from_db(con, unname(resolved))
  } else {
    .records_to_tibble(.as_record_list(
      .api_post(
        con, "/bulk/project-metadata",
        list(accessions = as.list(unname(resolved)))
      )
    ))
  }

  # a row can go missing silently; binding this beside the input would misalign
  missing <- names(resolved)[!resolved %in% out$accession]
  if (length(missing) > 0) {
    cli::cli_warn(c(
      "{length(missing)} of {length(resolved)} accession{?s} {?has/have} no project record.",
      i = "Missing: {.val {missing}}",
      i = "A sample, experiment or run accession has none; ask for its study."
    ))
  }
  out
}

#' The same short records, read from the dump
#'
#' Accessions are grouped by table. The dump lacks the organism column.
#' @noRd
.summaries_from_db <- function(con, accessions) {
  groups <- split(accessions, vapply(accessions, .accession_to_table, character(1)))
  frames <- lapply(names(groups), function(tbl) {
    accs <- groups[[tbl]]
    m <- .table_column_map(tbl)
    sql <- sprintf(
      "SELECT %s AS accession, %s AS title, %s AS description FROM %s WHERE %s IN (%s)",
      m$acc_col, m$title_col, m$desc_col, tbl, m$acc_col,
      paste(rep("?", length(accs)), collapse = ", ")
    )
    .db_query(con, sql, params = as.list(accs))
  })
  frames <- Filter(function(df) nrow(df) > 0, frames)
  if (length(frames) == 0) {
    return(tibble::tibble(accession = character(0)))
  }
  tibble::as_tibble(do.call(rbind, frames))
}
