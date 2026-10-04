#' Curated disease catalogues behind /disease/{collection}
#' @noRd
.disease_collections <- c("rare", "nord")

#' The server's collection lookup is exact-case; canonicalize before both the
#' membership check and the URL so `"RARE"` stays curated.
#' @noRd
.disease_canon <- function(collection) tolower(trimws(collection))

#' Tag filter params -> the response array column each fills, per curated
#' collection. `rare` is NIH GARD; `nord` is NORD.
#' @noRd
.disease_tags <- list(
  rare = c(category = "categories", specialty = "specialties", group = "groups"),
  nord = c(nord_type = "nord_types")
)

#' @noRd
.disease_curated_summary_spec <- function() {
  list(
    studies = .pnt_int, samples = .pnt_int,
    # corpus-wide cell sums run past 2^31
    cells = .pnt_num,
    studies_single_cell = .pnt_int, studies_cells_measured = .pnt_int,
    studies_human = .pnt_int, studies_human_primary = .pnt_int,
    studies_model = .pnt_int, studies_cell_line = .pnt_int,
    studies_with_ancestry = .pnt_int,
    stated_male = .pnt_int, stated_female = .pnt_int, stated_missing = .pnt_int,
    reads_male = .pnt_int, reads_female = .pnt_int
  )
}

#' @noRd
.disease_curated_project_spec <- function(collection) {
  base <- list(
    study_accession = .pnt_chr, title = .pnt_chr, organism = .pnt_chr,
    organisms = .pnt_list, n_samples = .pnt_int, n_diseases = .pnt_int,
    cells = .pnt_num, assay_category = .pnt_chr,
    stated_male = .pnt_int, stated_female = .pnt_int, stated_missing = .pnt_int,
    reads_male = .pnt_int, reads_female = .pnt_int,
    mondo_ids = .pnt_list, diseases = .pnt_list,
    ancestries = .pnt_list, inheritance = .pnt_list,
    has_fastq = .pnt_lgl, has_sra = .pnt_lgl,
    n_fastq_runs = .pnt_int, n_sra_runs = .pnt_int,
    n_human_primary = .pnt_int, n_model = .pnt_int, n_cell_line = .pnt_int,
    n_nonhuman = .pnt_int, n_unknown_organism = .pnt_int,
    cells_human_primary = .pnt_num, n_samples_in_scope = .pnt_int,
    catalogue_diseases = .pnt_list, catalogue_diseases_direct = .pnt_list,
    ancestors = .pnt_list
  )
  tags <- .disease_tags[[collection]]
  tag_spec <- stats::setNames(rep(list(.pnt_list), length(tags)), unname(tags))
  c(base, tag_spec)
}

#' Corpus totals for a disease collection or a free-text disease term
#'
#' `collection` is either a curated catalogue name (`"rare"` for NIH GARD,
#' `"nord"` for NORD) or any other string, resolved as free text against the
#' full MONDO ontology and expanded to its descendants. The two modes return
#' different columns: a curated summary carries per-scope study counts and
#' stated/read-derived sex tallies; a term summary carries
#' `term`/`resolution`/`matched_labels` describing how the text resolved,
#' plus `matched_samples` scoped to exactly the resolved MONDO ids (`samples`
#' is every sample in a matching study, not just the ones that resolved).
#'
#' A free-text term with no MONDO match 404s.
#'
#' @param collection Character. `"rare"`, `"nord"`, or a free-text disease
#'   name/MONDO term (e.g. `"fatty liver disease"`).
#' @inheritParams project
#' @return A one-row tibble. Columns depend on `collection`; see Details.
#'
#' @seealso [disease_facets()] for the filter values, [disease_projects()]
#'   for the studies themselves.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' DiseaseSummary("rare")
#' DiseaseSummary("fatty liver disease")
disease_summary <- function(collection, con = .con()) {
  .need_api(con, "disease_summary",
    why = "There is no disease collection table in the dump."
  )
  check_required(collection)
  canon <- .disease_canon(collection)
  if (canon %in% .disease_collections) {
    return(.simple_summary(
      con, paste0("/disease/", canon, "/summary"), .disease_curated_summary_spec()
    ))
  }
  .ontology_term_summary(con, "disease", collection, "disease_summary")
}

#' Disease facet counts
#'
#' Study counts per disease category/specialty/group (curated collections) or
#' organism/assay/journal/country/year/status (a free-text term); see
#' [disease_summary()] for the two modes.
#'
#' @inheritParams disease_summary
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [disease_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' DiseaseFacets("rare")
disease_facets <- function(collection, con = .con()) {
  .need_api(con, "disease_facets",
    why = "There is no disease collection table in the dump."
  )
  check_required(collection)
  canon <- .disease_canon(collection)
  if (canon %in% .disease_collections) {
    return(.simple_facets(con, paste0("/disease/", canon, "/facets")))
  }
  .ontology_term_facets(con, "disease", collection, "disease_facets")
}

#' Studies matching a disease collection or a free-text disease term
#'
#' One row per study, filtered and sorted; see [disease_summary()] for what
#' distinguishes a curated collection from a free-text term. A curated row
#' carries the catalogue match (`catalogue_diseases`, `mondo_ids`), per-scope
#' sample counts, and stated/read-derived sex tallies; `category`/
#' `specialty`/`group` only apply to `"rare"`, `nord_type` only to `"nord"`.
#' A term row carries the study's usual metadata plus
#' `n_samples_with_disease`, the count of samples resolved to `collection`
#' specifically (as opposed to `n_samples`, the study's total).
#'
#' `has_fastq`/`has_sra` are `NA` when the study is absent from the
#' download-links table (unknown, not unavailable); filtering on them
#' accepts only `TRUE` for that reason. `scope` (curated only) defaults to
#' `"human_primary"` (human material that is neither an immortalized line nor
#' a derived model); use `"patient_derived_model"`, `"cell_line"`, or `"all"`
#' to see what that excludes.
#'
#' @inheritParams disease_summary
#' @param category,specialty,group Character. `"rare"`-only filters, from
#'   [disease_facets()].
#' @param nord_type Character. `"nord"`-only filter, from [disease_facets()].
#' @param ancestry,inheritance,disease,assay_category Character. Curated
#'   filters shared by both collections.
#' @param organism,assay_l1,source Character. Filter to one value from
#'   [disease_facets()].
#' @param has_fastq,has_sra,is_single_cell,is_long_read Logical filters.
#' @param q Character. Case-insensitive substring match on title or
#'   study_accession.
#' @param scope One of `"human_primary"` (default), `"patient_derived_model"`,
#'   `"cell_line"`, `"all"`. Curated collections only.
#' @param sort A curated collection sorts by `"cells"` (default),
#'   `"n_samples"`, `"n_diseases"`, `"title"`, `"study_accession"`,
#'   `"assay_category"`, or `"organism"`; a free-text term sorts by
#'   `"pub_date"` (default), `"n_samples"`, `"n_experiments"`, `"title"`,
#'   `"study_accession"`, or `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#' @param offset Number of studies to skip. Curated collections only; a
#'   free-text term pages by cursor internally and errors if `offset` is set.
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' @seealso [disease_summary()], [disease_facets()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' DiseaseProjects("rare", category = "Cancers", limit = 100)
#' DiseaseProjects("fatty liver disease", organism = "Homo sapiens", limit = 10)
disease_projects <- function(collection, category = NULL, specialty = NULL,
                             group = NULL, nord_type = NULL, ancestry = NULL,
                             inheritance = NULL, disease = NULL,
                             assay_category = NULL, organism = NULL,
                             assay_l1 = NULL, source = NULL,
                             has_fastq = NULL, has_sra = NULL,
                             is_single_cell = NULL, is_long_read = NULL,
                             q = NULL, scope = "human_primary", sort = NULL,
                             order = "desc", limit = NULL, offset = 0,
                             con = .con()) {
  .need_api(con, "disease_projects",
    why = "There is no disease collection table in the dump."
  )
  check_required(collection)
  canon <- .disease_canon(collection)
  curated <- canon %in% .disease_collections

  if (!curated) {
    if (!identical(offset, 0)) {
      cli::cli_abort(c(
        "{.arg offset} does not apply to a free-text disease term.",
        i = "This paginates by cursor, not offset; leave {.arg offset} at its
             default and use {.arg limit} to cap how many rows come back."
      ))
    }
    params <- .lower_bools(list(
      organism = organism, assay_l1 = assay_l1, source = source,
      has_fastq = has_fastq, has_sra = has_sra,
      is_single_cell = is_single_cell, is_long_read = is_long_read, q = q,
      sort = sort %||% "pub_date", order = order
    ))
    return(.ontology_term_projects(
      con, "disease", collection, "n_samples_with_disease",
      params, limit, "disease_projects"
    ))
  }

  params <- .lower_bools(list(
    category = category, specialty = specialty, group = group,
    nord_type = nord_type, ancestry = ancestry, inheritance = inheritance,
    disease = disease, assay_category = assay_category, organism = organism,
    assay_l1 = assay_l1, source = source, has_fastq = has_fastq,
    has_sra = has_sra, is_single_cell = is_single_cell,
    is_long_read = is_long_read, q = q, scope = scope,
    sort = sort %||% "cells", order = order
  ))
  .walk_pages(
    con, paste0("/disease/", canon, "/projects"),
    params, .disease_curated_project_spec(canon), limit, offset
  )
}

#' Resolve a rare-disease name to its MONDO ids
#'
#' Matches `q` against the GARD and NORD catalogue names and their aliases,
#' so a colloquial or older name finds the MONDO ids [disease_projects()]
#' can then filter on.
#'
#' @param q Character. A disease name or part of one.
#' @param limit Maximum matches to return.
#' @inheritParams project
#'
#' @return A tibble with `display_name`, `alias`, `mondo_ids` and `sources`
#'   (list columns), with a `total` attribute for all matches and `truncated`
#'   for whether `total` exceeds `limit`.
#'
#' @seealso [disease_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' DiseaseAliases("marfan")
disease_aliases <- function(q, limit = 20, con = .con()) {
  .need_api(con, "disease_aliases",
    why = "There is no disease alias table in the dump."
  )
  check_required(q)
  res <- .api_get(con, "/disease/aliases", q = q, limit = limit)
  out <- .pnt_tibble(
    .as_record_list(res$results),
    list(
      display_name = .pnt_chr, alias = .pnt_chr,
      mondo_ids = .pnt_list, sources = .pnt_list
    )
  )
  attr(out, "total") <- res$total %||% 0L
  attr(out, "truncated") <- isTRUE(res$truncated)
  out
}
