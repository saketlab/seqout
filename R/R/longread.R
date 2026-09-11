#' Per-run PacBio/Oxford Nanopore chemistry schema
#'
#' Build lazily: pentimento.R defines the field parsers after this file loads.
#' @noRd
.lr_chem_spec <- function() {
  list(
    run_accession = .pnt_chr,
    study_accession = .pnt_chr,
    instrument_platform = .pnt_chr,
    instrument_model = .pnt_chr,
    chemistry = .pnt_chr,
    chemistry_confidence = .pnt_chr,
    chemistry_source = .pnt_chr,
    basecaller_software = .pnt_chr,
    basecaller_software_version = .pnt_chr,
    flow_cell_id = .pnt_chr,
    ont_pore = .pnt_chr,
    ont_kit = .pnt_chr,
    ont_speed_bps = .pnt_num,
    ont_model_tier = .pnt_chr,
    pacbio_platform_model = .pnt_chr,
    pacbio_chemistry_code = .pnt_chr,
    pacbio_binding_kit = .pnt_chr,
    pacbio_sequencing_kit = .pnt_chr,
    pacbio_smrtcell_kit = .pnt_chr
  )
}

#' Corpus-wide long-read totals
#'
#' Totals for studies with at least one PacBio or Oxford Nanopore experiment,
#' across GEO, SRA, ENA, DDBJ DRA and GSA. A study mirrored in more than one
#' archive counts once. `studies_hybrid` also sequenced on a short-read
#' platform; `studies_long_read_only` did not; the remainder have no
#' experiment rows to judge by (GEO-only entries).
#'
#' @inheritParams project
#' @return A one-row tibble of totals.
#'
#' @seealso [longread_facets()] for the filter values, [longread_projects()]
#'   for the studies themselves.
#'
#' @export
#' @examples
#' \dontrun{
#' LongreadSummary()
#' }
longread_summary <- function(con = .con()) {
  .need_api(con, "longread_summary",
    why = "There is no long-read collection table in the dump."
  )
  res <- .api_get(con, "/longread/summary")
  .pnt_tibble(
    list(res),
    list(
      studies = .pnt_int,
      experiments = .pnt_int,
      samples = .pnt_int,
      studies_pacbio = .pnt_int,
      studies_nanopore = .pnt_int,
      studies_both = .pnt_int,
      studies_long_read_only = .pnt_int,
      studies_hybrid = .pnt_int,
      studies_human = .pnt_int,
      studies_with_fastq = .pnt_int,
      studies_single_cell = .pnt_int,
      studies_exact_chemistry = .pnt_int,
      first_year = .pnt_int,
      last_year = .pnt_int
    )
  )
}

#' Long-read facet counts
#'
#' Study counts per technology, platform, instrument model, library strategy,
#' organism, archive, chemistry and year.
#'
#' @inheritParams project
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [longread_projects()].
#'
#' @export
#' @examples
#' \dontrun{
#' f <- LongreadFacets()
#' f[f$facet == "technology", ]
#' }
longread_facets <- function(con = .con()) {
  .need_api(con, "longread_facets",
    why = "There is no long-read collection table in the dump."
  )
  res <- .api_get(con, "/longread/facets")
  rows <- unlist(
    lapply(names(res), function(facet) {
      lapply(res[[facet]], function(v) list(facet = facet, value = v$value, studies = v$studies))
    }),
    recursive = FALSE
  )
  .pnt_tibble(rows, list(facet = .pnt_chr, value = .pnt_chr, studies = .pnt_int))
}

#' @noRd
.lr_project_spec <- function() {
  list(
    study_accession = .pnt_chr,
    accessions = .pnt_list,
    archives = .pnt_list,
    technologies = .pnt_list,
    platforms = .pnt_list,
    instrument_models = .pnt_list,
    library_strategies = .pnt_list,
    n_experiments = .pnt_int,
    n_experiments_total = .pnt_int,
    long_read_only = .pnt_lgl,
    title = .pnt_chr,
    organism = .pnt_chr,
    organisms = .pnt_list,
    n_samples = .pnt_int,
    assay_l1 = .pnt_chr,
    is_single_cell = .pnt_lgl,
    country = .pnt_chr,
    pmid = .pnt_chr,
    first_published = .pnt_chr,
    year = .pnt_int,
    has_fastq = .pnt_lgl,
    has_sra = .pnt_lgl,
    n_runs = .pnt_int,
    n_fastq_runs = .pnt_int,
    n_sra_runs = .pnt_int,
    chemistries = .pnt_list,
    n_chemistry_runs = .pnt_int,
    n_chemistry_exact = .pnt_int
  )
}

#' /longread/projects caps a page at 200 rows.
#' @noRd
.lr_page <- 200L

#' Studies with a PacBio or Oxford Nanopore experiment, any archive
#'
#' One row per study; a study mirrored in more than one archive counts once.
#' `long_read_only = TRUE` had no other platform; `FALSE` is hybrid; `NA` has
#' no experiment rows to judge by (GEO-only entries). Filter values come from
#' [longread_facets()].
#'
#' `single_cell` keeps only studies also flagged single-cell
#' (`is_single_cell`). The server has no such parameter, so this filters
#' locally.
#'
#' @param technology,platform,instrument_model,library_strategy,organism,archive,chemistry,assay_l1
#'   Character. Filter to one value from [longread_facets()].
#' @param year Integer. Publication year.
#' @param has_fastq,has_sra,long_read_only,has_exact_chemistry Logical filters.
#' @param single_cell `TRUE`/`FALSE` to keep only studies with (or without) a
#'   single-cell assay; `NULL` (default) leaves both in.
#' @param sort One of `"n_experiments"`, `"n_samples"`, `"n_runs"`,
#'   `"first_published"`, `"title"`, `"study_accession"`, `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#' @param offset Number of studies to skip.
#' @inheritParams project
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' @seealso [longread_summary()], [longread_facets()],
#'   [project_longread_chemistry()] for one study's per-run detail.
#'
#' @export
#' @examples
#' \dontrun{
#' # long-read-only datasets
#' LongreadProjects(long_read_only = TRUE, limit = 100)
#'
#' # long-read AND single-cell
#' LongreadProjects(single_cell = TRUE, limit = 100)
#'
#' # Oxford Nanopore human studies, newest first
#' LongreadProjects(
#'   technology = "Oxford Nanopore", organism = "Homo sapiens",
#'   sort = "first_published"
#' )
#' }
longread_projects <- function(technology = NULL, platform = NULL,
                              instrument_model = NULL, library_strategy = NULL,
                              organism = NULL, archive = NULL, chemistry = NULL,
                              assay_l1 = NULL, year = NULL, has_fastq = NULL,
                              has_sra = NULL, long_read_only = NULL,
                              has_exact_chemistry = NULL, single_cell = NULL,
                              sort = "n_experiments", order = "desc",
                              limit = NULL, offset = 0, con = .con()) {
  .need_api(con, "longread_projects",
    why = "There is no long-read collection table in the dump."
  )
  params <- .lower_bools(list(
    technology = technology, platform = platform,
    instrument_model = instrument_model, library_strategy = library_strategy,
    organism = organism, archive = archive, chemistry = chemistry,
    assay_l1 = assay_l1, year = year,
    has_fastq = has_fastq, has_sra = has_sra,
    long_read_only = long_read_only,
    has_exact_chemistry = has_exact_chemistry,
    sort = sort, order = order
  ))
  # survivor count is unknown, so want can't shrink toward limit
  walk_all <- !is.null(single_cell)

  pages <- list()
  kept <- 0L
  at <- offset
  total <- 0L
  repeat {
    want <- .lr_page
    if (!walk_all && !is.null(limit)) want <- min(limit - kept, .lr_page)
    if (want <= 0) break

    res <- do.call(.api_get, c(
      list(con = con, path = "/longread/projects"),
      params, list(limit = want, offset = at)
    ))
    total <- res$total
    rows <- .as_record_list(res$results)
    got <- length(rows)
    at <- at + got

    if (!is.null(single_cell)) {
      rows <- Filter(function(r) isTRUE(r$is_single_cell) == single_cell, rows)
    }
    if (length(rows)) {
      pages[[length(pages) + 1L]] <- rows
      kept <- kept + length(rows)
    }
    # a stale total would otherwise page forever
    if (got == 0 || at >= total) break
    # later pages can't outrank kept rows: results arrive in sort order
    if (!is.null(limit) && kept >= limit) break
  }

  if (length(pages) == 0) {
    out <- .pnt_tibble(list(), .lr_project_spec())
  } else {
    records <- unlist(pages, recursive = FALSE, use.names = FALSE)
    if (!is.null(limit) && length(records) > limit) {
      records <- records[seq_len(limit)]
    }
    out <- .pnt_tibble(records, .lr_project_spec())
  }
  attr(out, "total") <- total
  out
}

#' Get PacBio/Oxford Nanopore chemistry calls for a study
#'
#' Every PacBio/Oxford Nanopore run in the study, independent of single-cell
#' status and Pentimento linkage. `chemistry_confidence` is `exact` when read
#' from the submitted BAM's own header, `declared` (ONT only) when parsed from
#' the depositor's own protocol text, `bucket` when inferred from
#' `instrument_model` alone, `unknown` otherwise.
#'
#' @param accession A study or series accession, or one resolving to a study.
#' @inheritParams project
#'
#' @return A run tibble, empty when the study has no long-read runs.
#'
#' @seealso [project_single_cell()], whose `longread_chemistry` attribute
#'   answers the same question restricted to the study's first page of
#'   samples.
#'
#' @export
#' @examples
#' \dontrun{
#' ProjectLongreadChemistry("GSE297547")
#' }
project_longread_chemistry <- function(accession, con = .con()) {
  .need_api(con, "project_longread_chemistry",
    why = "There is no long-read chemistry table in the dump."
  )
  check_required(accession)

  path <- paste0(
    "/project/", toupper(trimws(accession)), "/longread-chemistry"
  )
  res <- .api_get(con, path)
  .pnt_tibble(.as_record_list(res$runs), .lr_chem_spec())
}
