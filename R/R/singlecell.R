#' @noRd
.sc_summary_spec <- function() {
  list(
    studies = .pnt_int, samples = .pnt_int,
    # corpus-wide cell sums run past 2^31
    cells = .pnt_num,
    studies_with_matrix = .pnt_int, studies_with_fastq = .pnt_int,
    studies_long_read = .pnt_int, studies_with_perturbation = .pnt_int,
    studies_human = .pnt_int, n_modalities = .pnt_int,
    first_year = .pnt_int, last_year = .pnt_int
  )
}

#' @noRd
.sc_project_spec <- function() {
  list(
    study_accession = .pnt_chr, title = .pnt_chr, organism = .pnt_chr,
    organisms = .pnt_list, tissues = .pnt_list,
    single_cell_modality = .pnt_chr, chemistries = .pnt_list,
    cell_or_nucleus = .pnt_list, assay_l1 = .pnt_chr,
    n_samples = .pnt_int, has_matrix = .pnt_lgl,
    n_cells = .pnt_num, has_fastq = .pnt_lgl, n_fastq_runs = .pnt_int,
    has_sra = .pnt_lgl, n_runs = .pnt_int, is_long_read = .pnt_lgl,
    perturbation_method = .pnt_list, intervention_kind = .pnt_list,
    is_pooled = .pnt_lgl, country = .pnt_chr, pmid = .pnt_chr, year = .pnt_int
  )
}

#' Corpus-wide single-cell totals
#'
#' Totals for studies with matrix or read-derived single-cell evidence, or a
#' declared single-cell classification; the population
#' [singlecell_projects()] lists. `cells` excludes studies whose only matrix
#' is unfiltered (raw 10x barcodes, not real cells).
#'
#' @inheritParams project
#' @return A one-row tibble of totals.
#'
#' @seealso [singlecell_facets()] for the filter values, [singlecell_projects()]
#'   for the studies themselves.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' SingleCellSummary()
singlecell_summary <- function(con = .con()) {
  .need_api(con, "singlecell_summary",
    why = "There is no single-cell collection table in the dump."
  )
  .simple_summary(con, "/single-cell/summary", .sc_summary_spec())
}

#' Single-cell facet counts
#'
#' Study counts per chemistry, organism, tissue, modality, assay category,
#' year, and has_matrix/has_fastq/is_long_read status.
#'
#' @inheritParams project
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [singlecell_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' f <- SingleCellFacets()
#' f[f$facet == "chemistry", ]
singlecell_facets <- function(con = .con()) {
  .need_api(con, "singlecell_facets",
    why = "There is no single-cell collection table in the dump."
  )
  .simple_facets(con, "/single-cell/facets")
}

#' Studies with single-cell evidence
#'
#' One row per study with matrix or read-derived single-cell evidence, or a
#' declared single-cell classification: modality, chemistries (read-derived
#' barcode chemistry), `cell_or_nucleus` (read-derived from intron fraction /
#' mito %, independent of chemistry; `NA` when never scanned or ambiguous),
#' tissues, organisms, sample count, matrix availability, FASTQ/.sra
#' availability, and whether the study also has long-read sequencing.
#'
#' `perturbation_method` is a named method (Perturb-seq, CROP-seq,
#' ECCITE-seq, Mosaic-seq, sci-Plex, CRISPR-detect) mentioned in the study's
#' title or description, not a confirmed design; `NA` means none was
#' detected. `intervention_kind` (genetic/chemical) and `is_pooled` follow
#' from which method matched. Filter values come from [singlecell_facets()].
#'
#' @param chemistry,organism,tissue,cell_or_nucleus,perturbation_method,intervention_kind,modality,assay_l1
#'   Character. Filter to one value from [singlecell_facets()].
#' @param year Integer. Publication year.
#' @param has_matrix,has_fastq,has_sra,is_long_read Logical filters.
#' @param q Character. Case-insensitive substring match on title or
#'   study_accession.
#' @param sort One of `"n_samples"`, `"n_cells"`, `"n_runs"`,
#'   `"n_fastq_runs"`, `"year"`, `"title"`, `"study_accession"`, `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#' @param offset Number of studies to skip.
#' @inheritParams project
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' @seealso [singlecell_summary()], [singlecell_facets()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' SingleCellProjects(tissue = "liver", has_matrix = TRUE, limit = 100)
singlecell_projects <- function(chemistry = NULL, organism = NULL, tissue = NULL,
                                cell_or_nucleus = NULL, perturbation_method = NULL,
                                intervention_kind = NULL, modality = NULL,
                                assay_l1 = NULL, year = NULL, has_matrix = NULL,
                                has_fastq = NULL, has_sra = NULL, is_long_read = NULL,
                                q = NULL, sort = "year", order = "desc",
                                limit = NULL, offset = 0, con = .con()) {
  .need_api(con, "singlecell_projects",
    why = "There is no single-cell collection table in the dump."
  )
  params <- .lower_bools(list(
    chemistry = chemistry, organism = organism, tissue = tissue,
    cell_or_nucleus = cell_or_nucleus, perturbation_method = perturbation_method,
    intervention_kind = intervention_kind, modality = modality,
    assay_l1 = assay_l1, year = year, has_matrix = has_matrix,
    has_fastq = has_fastq, has_sra = has_sra, is_long_read = is_long_read,
    q = q, sort = sort, order = order
  ))
  .walk_pages(con, "/single-cell/projects", params, .sc_project_spec(), limit, offset)
}
