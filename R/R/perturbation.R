#' @noRd
.pert_summary_spec <- function() {
  list(
    studies = .pnt_int, studies_high_medium = .pnt_int, studies_high = .pnt_int,
    studies_genetic = .pnt_int, studies_chemical = .pnt_int,
    studies_with_matrix = .pnt_int, studies_with_fastq = .pnt_int,
    studies_matrix_and_fastq = .pnt_int, studies_human = .pnt_int,
    samples = .pnt_int,
    # corpus-wide cell sums can pass 2^31
    cells = .pnt_num,
    first_year = .pnt_int, last_year = .pnt_int
  )
}

#' @noRd
.pert_project_spec <- function() {
  c(.sc_evidence_project_spec(), list(
    perturbation_type = .pnt_chr, confidence = .pnt_chr,
    genetic_confidence = .pnt_chr, chemical_confidence = .pnt_chr,
    genetic_subtypes = .pnt_list, perturbation_methods = .pnt_list,
    compounds = .pnt_list, title_compounds = .pnt_list, stimuli = .pnt_list,
    has_control_arm = .pnt_lgl, n_compound_values = .pnt_int,
    is_pooled = .pnt_lgl, evidence = .pnt_list,
    country = .pnt_chr, pmid = .pnt_chr, year = .pnt_int
  ))
}

#' Perturbation-study corpus totals
#'
#' Totals for single-cell studies with genetic or chemical perturbation
#' evidence, the same population [perturbation_projects()] lists.
#' `studies_high_medium` counts the studies whose evidence is strong enough to
#' rely on; `studies` also counts weak single-signal calls.
#'
#' @inheritParams project
#' @return A one-row tibble of totals.
#'
#' @seealso [perturbation_facets()] for the filter values,
#'   [perturbation_projects()] for the studies themselves.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' PerturbationSummary()
perturbation_summary <- function(con = .con()) {
  .need_api(con, "perturbation_summary",
    why = "There is no perturbation collection table in the dump."
  )
  .simple_summary(con, "/perturbation/summary", .pert_summary_spec())
}

#' Perturbation-study facet counts
#'
#' Study counts per perturbation type, confidence, data availability, genetic
#' tool, perturbation method, compound, organism, tissue, readout assay and
#' year. Each facet holds its top 100 values.
#'
#' @inheritParams project
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [perturbation_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' f <- PerturbationFacets()
#' f[f$facet == "perturbation_method", ]
perturbation_facets <- function(con = .con()) {
  .need_api(con, "perturbation_facets",
    why = "There is no perturbation collection table in the dump."
  )
  .simple_facets(con, "/perturbation/facets")
}

#' Single-cell perturbation studies
#'
#' One row per single-cell study with genetic (CRISPR knockout, CRISPRi,
#' CRISPRa, RNAi, ORF, base or prime editing), chemical (drug or biologic) or
#' other-stimulus perturbation evidence, with the readout assay and whether a
#' counted matrix, raw FASTQ, both or neither is available.
#'
#' Detection is rule-based, from named
#' methods in the study's own text (Perturb-seq, CROP-seq, ECCITE-seq,
#' Mosaic-seq, TAP-seq, Spear-ATAC, sci-Plex, MIX-Seq and others), guide-library
#' and pooled-screen wording, a control-arm design test on sample treatment
#' values, and a ChEBI compound lexicon.
#'
#' `confidence` is `"high"`, `"medium"` or `"low"`. High needs a named method,
#' a guide library with screen text, or several compound treatments beside a
#' control arm. Medium is corroborated by a second signal. Low is a single weak
#' signal and includes false positives, so start from
#' `min_confidence = "medium"` when you want studies to rely on. `evidence`
#' lists the signals behind each row. `perturbation_type` is `"genetic"`,
#' `"chemical"`, `"both"` or `"other"` (a cytokine or stimulation design with a
#' control). Germline knockout and transgenic models are not evidence, and
#' doxycycline or tamoxifen used as Cre or Tet inducers never count as the
#' perturbation.
#'
#' `compounds` are ChEBI-matched names from sample treatment values. They are
#' empty when the drug arms live only in supplementary files or cell barcodes,
#' as in sci-Plex, so a named method with no compounds is expected.
#' `data_availability` is `"both"`, `"matrix_only"`, `"fastq_only"` or
#' `"neither"`, from `has_matrix` and `has_fastq`. Filter values come from
#' [perturbation_facets()].
#'
#' @param perturbation_type One of `"genetic"`, `"chemical"`, `"both"`,
#'   `"other"`.
#' @param confidence One of `"high"`, `"medium"`, `"low"`; matches that tier
#'   exactly.
#' @param min_confidence One of `"high"`, `"medium"`, `"low"`; matches that
#'   tier and stronger, so `"medium"` keeps high and medium.
#' @param data_availability One of `"both"`, `"matrix_only"`, `"fastq_only"`,
#'   `"neither"`.
#' @param genetic_subtype,perturbation_method,compound,readout_assay,cell_line,organism,tissue
#'   Character. Filter to one value from [perturbation_facets()].
#' @param year Integer. Publication year.
#' @param has_matrix,has_fastq,has_control_arm,is_pooled,is_long_read Logical filters.
#' @param q Character. Case-insensitive substring match on title or
#'   study_accession.
#' @param sort One of `"confidence"`, the default, `"n_samples"`, `"n_cells"`,
#'   `"year"`, `"title"`, `"study_accession"`, `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#' @param offset Number of studies to skip.
#' @inheritParams project
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' @seealso [perturbation_summary()], [perturbation_facets()],
#'   [seqout_counts()] to read the matrices of a study with `has_matrix`.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' # studies to rely on that have both a matrix and FASTQ
#' PerturbationProjects(
#'   min_confidence = "medium", data_availability = "both", limit = 100
#' )
#'
#' # CRISPRi screens in human
#' PerturbationProjects(
#'   perturbation_type = "genetic", genetic_subtype = "CRISPRi",
#'   organism = "Homo sapiens", min_confidence = "medium", limit = 10
#' )
#'
#' # drug studies that name trametinib
#' PerturbationProjects(compound = "trametinib", has_matrix = TRUE, limit = 10)
perturbation_projects <- function(perturbation_type = NULL, confidence = NULL,
                                  min_confidence = NULL, data_availability = NULL,
                                  genetic_subtype = NULL, perturbation_method = NULL,
                                  compound = NULL, readout_assay = NULL, cell_line = NULL,
                                  organism = NULL, tissue = NULL, year = NULL,
                                  has_matrix = NULL, has_fastq = NULL,
                                  has_control_arm = NULL, is_pooled = NULL,
                                  is_long_read = NULL,
                                  q = NULL, sort = "confidence", order = "desc",
                                  limit = NULL, offset = 0, con = .con()) {
  .need_api(con, "perturbation_projects",
    why = "There is no perturbation collection table in the dump."
  )
  params <- .lower_bools(list(
    perturbation_type = perturbation_type, confidence = confidence,
    min_confidence = min_confidence, data_availability = data_availability,
    genetic_subtype = genetic_subtype, perturbation_method = perturbation_method,
    compound = compound, readout_assay = readout_assay, cell_line = cell_line,
    organism = organism, tissue = tissue, year = year,
    has_matrix = has_matrix, has_fastq = has_fastq,
    has_control_arm = has_control_arm, is_pooled = is_pooled,
    is_long_read = is_long_read,
    q = q, sort = sort, order = order
  ))
  .walk_pages(con, "/perturbation/projects", params, .pert_project_spec(), limit, offset)
}
