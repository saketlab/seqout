#' @noRd
.country_summary_spec <- function() {
  list(
    studies = .pnt_int, samples = .pnt_int, experiments = .pnt_int,
    studies_with_fastq = .pnt_int, studies_with_sra = .pnt_int,
    studies_human = .pnt_int, studies_single_cell = .pnt_int,
    studies_long_read = .pnt_int, n_organisms = .pnt_int,
    first_year = .pnt_int, last_year = .pnt_int
  )
}

#' @noRd
.country_project_spec <- function() {
  list(
    study_accession = .pnt_chr, title = .pnt_chr, organism = .pnt_chr,
    assay_l1 = .pnt_chr, assay_l2 = .pnt_chr, source = .pnt_chr,
    n_samples = .pnt_int, n_experiments = .pnt_int,
    is_single_cell = .pnt_lgl, single_cell_modality = .pnt_chr,
    center_name = .pnt_chr, pmid = .pnt_chr, year = .pnt_int,
    has_fastq = .pnt_lgl, has_sra = .pnt_lgl,
    n_runs = .pnt_int, n_fastq_runs = .pnt_int, n_sra_runs = .pnt_int,
    # joined from the single-cell/long-read collections; can run past 2^31
    has_matrix = .pnt_lgl, n_cells = .pnt_num, has_long_read = .pnt_lgl,
    technologies = .pnt_list
  )
}

#' Build a `/country/{code}/...` path the way the server normalizes codes
#' @noRd
.country_path <- function(code, suffix) {
  paste0("/country/", toupper(trimws(code)), suffix)
}

#' Corpus totals for one country's submitted studies
#'
#' `code` is an ISO-3166-1 alpha-2 code (e.g. `"US"`, `"IN"`); matching is
#' case-insensitive. A code that isn't two letters, or matches nothing, 404s.
#'
#' @param code Character. A two-letter country code.
#' @inheritParams project
#' @return A one-row tibble of totals.
#'
#' @seealso [country_facets()] for the filter values, [country_projects()]
#'   for the studies themselves.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' CountrySummary("US")
country_summary <- function(code, con = .con()) {
  .need_api(con, "country_summary",
    why = "There is no country collection table in the dump."
  )
  check_required(code)
  .simple_summary(con, .country_path(code, "/summary"), .country_summary_spec())
}

#' Per-country facet counts
#'
#' Study counts per organism, assay category, archive, year and single-cell
#' status for one country. Each facet holds its top 40 values.
#'
#' @inheritParams country_summary
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [country_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' f <- CountryFacets("IN")
#' f[f$facet == "organism", ]
country_facets <- function(code, con = .con()) {
  .need_api(con, "country_facets",
    why = "There is no country collection table in the dump."
  )
  check_required(code)
  .simple_facets(con, .country_path(code, "/facets"))
}

#' Studies submitted from a country
#'
#' One row per study submitted from `code`. Filter values come from
#' [country_facets()].
#'
#' @param code Character. A two-letter country code.
#' @param organism,assay_l1,source Character. Filter to one value from
#'   [country_facets()].
#' @param has_fastq,has_sra,is_single_cell Logical filters.
#' @param q Character. Case-insensitive substring match on title or
#'   study_accession.
#' @param sort One of `"n_samples"`, `"n_experiments"`, `"year"`, `"title"`,
#'   `"study_accession"`, `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#' @param offset Number of studies to skip.
#' @inheritParams project
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' @seealso [country_summary()], [country_facets()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' # single-cell studies submitted from India, newest first
#' CountryProjects("IN", is_single_cell = TRUE, limit = 100)
country_projects <- function(code, organism = NULL, assay_l1 = NULL,
                             source = NULL, has_fastq = NULL, has_sra = NULL,
                             is_single_cell = NULL, q = NULL,
                             sort = "year", order = "desc",
                             limit = NULL, offset = 0, con = .con()) {
  .need_api(con, "country_projects",
    why = "There is no country collection table in the dump."
  )
  check_required(code)
  params <- .lower_bools(list(
    organism = organism, assay_l1 = assay_l1, source = source,
    has_fastq = has_fastq, has_sra = has_sra, is_single_cell = is_single_cell,
    q = q, sort = sort, order = order
  ))
  .walk_pages(
    con, .country_path(code, "/projects"), params, .country_project_spec(), limit, offset
  )
}
