#' Find a publication and the projects linked to it
#'
#' The reverse lookup: from a paper to the datasets that name it.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param pmid A PubMed ID.
#' @param doi A DOI. Give one of `pmid` or `doi`.
#'
#' @return A tibble of linked projects, empty when the publication is unknown.
#'
#' @export
#' @examples
#' \dontrun{
#' Paper(pmid = "34764296")
#' }
paper <- function(pmid = NULL, doi = NULL, con = .con()) {
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
#' The archive holds the link from a dataset to its paper, so the entry is
#' assembled from the record rather than looked up by hand. The result is text,
#' ready for [writeLines()] or a `.bib` file.
#'
#' `type = "original"` gives the paper the submitters wrote. `type = "all"`
#' adds the papers that reanalysed the data afterwards.
#'
#' A dataset with no linked paper returns `character(0)`, not an error, so a
#' loop over many accessions does not stop at the first one without a paper.
#'
#' Reads the REST API. The dump has no record of the papers that reanalysed a
#' dataset, and only about a third of its `pubmed_metadata` rows carry a
#' publication date, so an entry built from it would be quietly less complete.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A project accession.
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
#' # Every paper that used the data, not only the one that produced it
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
  project_citations(accession, type = type, format = "bibtex", con = con)
}


#' Short project records for many accessions
#'
#' One request for many projects, rather than one request each.
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

  # A BioProject accession has no record of its own; the endpoint answers the
  # study the archive files it under. Names keep the accession that was asked
  # for, so a report of what is missing reads as the caller wrote it.
  resolved <- vapply(accessions, function(a) .prj_study(con, a), character(1))

  out <- if (identical(con$backend, "parquet")) {
    .summaries_from_db(con, unname(resolved))
  } else {
    .records_to_tibble(.as_record_list(
      .api_post(con, "/bulk/project-metadata",
        list(accessions = as.list(unname(resolved)))
      )
    ))
  }

  # The endpoint answers only what it holds, so a row can go missing without a
  # word. Say so: a caller binding this beside its input would misalign.
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
#' Each archive keeps its projects in its own table, so the accessions are
#' grouped by the table that holds them and each group is asked for once.
#' The dump carries no organism column here, so the result is three columns
#' where the API answers four.
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


