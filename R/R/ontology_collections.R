#' Free-text ontology-term collections behind /tissue/{term} and, for a
#' string outside the curated catalogues, /disease/{term}.
#'
#' Both resolve free text against a full ontology (UBERON for tissue, MONDO
#' for disease) and share one response shape.
#' @noRd
NULL

#' @noRd
.ot_summary_spec <- function() {
  list(
    studies = .pnt_int, samples = .pnt_int, experiments = .pnt_int,
    # scoped to the resolved id set, unlike samples
    matched_samples = .pnt_int,
    studies_with_fastq = .pnt_int, studies_with_sra = .pnt_int,
    studies_human = .pnt_int, studies_single_cell = .pnt_int,
    studies_long_read = .pnt_int, n_organisms = .pnt_int,
    first_date = .pnt_chr, last_date = .pnt_chr,
    term = .pnt_chr, resolution = .pnt_chr, matched_labels = .pnt_list
  )
}

#' @param n_col The study-scoped match-count column: `n_samples_with_tissue`
#'   or `n_samples_with_disease`.
#' @noRd
.ot_project_spec <- function(n_col) {
  spec <- list(
    study_accession = .pnt_chr, title = .pnt_chr, organism = .pnt_chr,
    assay_l1 = .pnt_chr, assay_l2 = .pnt_chr, source = .pnt_chr,
    journal = .pnt_chr, country_code_iso2 = .pnt_chr, pub_date = .pnt_chr,
    n_samples = .pnt_int, n_experiments = .pnt_int,
    is_single_cell = .pnt_lgl, single_cell_modality = .pnt_chr
  )
  spec[[n_col]] <- .pnt_int
  c(spec, list(
    has_fastq = .pnt_lgl, has_sra = .pnt_lgl,
    n_runs = .pnt_int, n_fastq_runs = .pnt_int, n_sra_runs = .pnt_int,
    is_long_read = .pnt_lgl
  ))
}

#' Percent-encode a free-text path segment
#'
#' `req_url_path_append()` does not escape spaces or punctuation itself, and
#' tissue/disease terms routinely contain both ("fatty liver disease").
#' @noRd
.ot_path_term <- function(x) curl::curl_escape(trimws(x))

#' @param kind `"tissue"` or `"disease"`.
#' @param what The exported function name, for the REST-only error.
#' @noRd
.ontology_term_summary <- function(con, kind, term, what) {
  .need_api(con, what,
    why = "There is no ontology-term collection table in the dump."
  )
  check_required(term)
  .simple_summary(
    con, paste0("/", kind, "/", .ot_path_term(term), "/summary"), .ot_summary_spec()
  )
}

#' @noRd
.ontology_term_facets <- function(con, kind, term, what) {
  .need_api(con, what,
    why = "There is no ontology-term collection table in the dump."
  )
  check_required(term)
  .simple_facets(con, paste0("/", kind, "/", .ot_path_term(term), "/facets"))
}

#' @param params Named list of filter/sort query parameters, already
#'   lower-cased where boolean, without cursor params; `.walk_pages()` adds them.
#' @noRd
.ontology_term_projects <- function(con, kind, term, n_col, params, limit, what) {
  .need_api(con, what,
    why = "There is no ontology-term collection table in the dump."
  )
  check_required(term)
  .walk_pages(
    con, paste0("/", kind, "/", .ot_path_term(term), "/projects"),
    params, .ot_project_spec(n_col), limit,
    keyset = TRUE
  )
}
