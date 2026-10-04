#' Corpus totals for studies with a sample in a given tissue
#'
#' `term` is resolved as free text against the full UBERON ontology and
#' expanded to its descendants (`"blood"` also reaches `"whole blood"`,
#' `"peripheral blood mononuclear cell"`, ...). `resolution` says whether it
#' matched an UBERON label exactly or only as a substring; `matched_labels`
#' lists what actually matched. `matched_samples` counts only samples
#' resolved to one of the matched ids; `samples` is the matching studies'
#' total sample count across all annotations.
#'
#' A term with no match 404s.
#'
#' @param term Character. A tissue name or UBERON term, e.g. `"liver"`.
#' @inheritParams project
#' @return A one-row tibble of totals.
#'
#' @seealso [tissue_facets()] for the filter values, [tissue_projects()] for
#'   the studies themselves.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' TissueSummary("liver")
tissue_summary <- function(term, con = .con()) {
  .ontology_term_summary(con, "tissue", term, "tissue_summary")
}

#' Per-tissue facet counts
#'
#' Study counts per organism, assay category, archive, journal, submitter
#' country, year, and FASTQ/single-cell/long-read status for studies matching
#' `term`.
#'
#' @inheritParams tissue_summary
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [tissue_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' f <- TissueFacets("liver")
#' f[f$facet == "organism", ]
tissue_facets <- function(term, con = .con()) {
  .ontology_term_facets(con, "tissue", term, "tissue_facets")
}

#' Studies with a sample in a given tissue
#'
#' One row per study with a sample annotated with a tissue matching `term`.
#' `has_fastq`/`has_sra` are `NA` when the study is absent from the
#' download-links table (unknown, not unavailable); filtering on them
#' accepts only `TRUE` for that reason. `n_samples_with_tissue` counts every
#' sample the study has any resolved tissue for; [tissue_summary()]'s
#' `matched_samples` counts only the ones matching `term`.
#'
#' @inheritParams tissue_summary
#' @param organism,assay_l1,source Character. Filter to one value from
#'   [tissue_facets()].
#' @param has_fastq,has_sra,is_single_cell,is_long_read Logical filters.
#' @param q Character. Case-insensitive substring match on title or
#'   study_accession.
#' @param sort One of `"pub_date"` (default), `"n_samples"`,
#'   `"n_experiments"`, `"title"`, `"study_accession"`, `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' Pages by cursor internally, as [seqout_search()]'s `sortby` pagination
#' does. There is no `offset` argument; `limit` caps the rows returned.
#'
#' @seealso [tissue_summary()], [tissue_facets()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' TissueProjects("liver", organism = "Homo sapiens", limit = 100)
tissue_projects <- function(term, organism = NULL, assay_l1 = NULL,
                            source = NULL, has_fastq = NULL, has_sra = NULL,
                            is_single_cell = NULL, is_long_read = NULL,
                            q = NULL, sort = "pub_date", order = "desc",
                            limit = NULL, con = .con()) {
  params <- .lower_bools(list(
    organism = organism, assay_l1 = assay_l1, source = source,
    has_fastq = has_fastq, has_sra = has_sra,
    is_single_cell = is_single_cell, is_long_read = is_long_read,
    q = q, sort = sort, order = order
  ))
  .ontology_term_projects(
    con, "tissue", term, "n_samples_with_tissue",
    params, limit, "tissue_projects"
  )
}
