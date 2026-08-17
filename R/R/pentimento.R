#' @noRd
.pnt_chr <- function(x) if (is.null(x)) NA_character_ else as.character(x)[1]

#' @noRd
.pnt_int <- function(x) if (is.null(x)) NA_integer_ else as.integer(x)[1]

#' @noRd
.pnt_num <- function(x) if (is.null(x)) NA_real_ else as.numeric(x)[1]

#' NA (JSON null) means unscreened; FALSE means screened with no hit.
#' @noRd
.pnt_lgl <- function(x) if (is.null(x)) NA else as.logical(x)[1]

#' @noRd
.pnt_list <- function(x) {
  if (is.null(x)) {
    return(list(NULL))
  }
  list(as.character(unlist(x, use.names = FALSE)))
}

#' @noRd
.pnt_tibble <- function(records, spec) {
  if (length(records) == 0) {
    empty <- lapply(spec, function(f) f(NULL)[0])
    return(tibble::as_tibble(empty))
  }
  cols <- Map(function(f, nm) {
    unlist(lapply(records, function(r) f(r[[nm]])),
      recursive = FALSE, use.names = FALSE
    )
  }, spec, names(spec))
  tibble::as_tibble(cols)
}

#' /single-cell caps a page at 1000 rows.
#' @noRd
.pnt_page <- 1000L

# Explicit specs preserve types and tri-state nulls that `.records_to_tibble` cannot.
.pnt_sample_spec <- list(
  sample_accession = .pnt_chr,
  cells = .pnt_int,
  genes = .pnt_int,
  nnz = .pnt_num,
  file_format = .pnt_chr,
  unfiltered = .pnt_lgl,
  n_runs = .pnt_int,
  n_runs_measurable = .pnt_int,
  species_called = .pnt_chr,
  species_confidence = .pnt_chr,
  species_hit_reads = .pnt_int,
  species_hit_fraction = .pnt_num,
  species_runner_up = .pnt_chr,
  species_margin = .pnt_num,
  species_ambiguous = .pnt_lgl,
  species_mislabel = .pnt_lgl,
  sex_verdict = .pnt_chr,
  sex_confidence = .pnt_chr,
  sex_reads_scanned = .pnt_int,
  y_hits = .pnt_int,
  xist_hits = .pnt_int,
  y_xist_ratio = .pnt_num,
  sex_panel_status = .pnt_chr,
  sex_mixed_suspected = .pnt_lgl,
  deep_n_reads = .pnt_int,
  assay = .pnt_chr,
  assay_display = .pnt_chr,
  assay_is_single_cell = .pnt_lgl,
  calls_ambiguous = .pnt_lgl,
  flags = .pnt_list,
  n_flags = .pnt_int,
  hpv_top_type = .pnt_chr,
  hpv_ambiguous = .pnt_lgl,
  has_viral_reads = .pnt_lgl,
  has_bacterial_reads = .pnt_lgl,
  viral_kmer_mass = .pnt_num,
  bacterial_kmer_mass = .pnt_num,
  title = .pnt_chr,
  tissue = .pnt_chr
)

.pnt_study_spec <- list(
  study_accession = .pnt_chr,
  source = .pnt_chr,
  title = .pnt_chr,
  study_cells = .pnt_num,
  cells_unfiltered = .pnt_lgl,
  single_cell_file_format = .pnt_chr,
  n_samples_reported = .pnt_int,
  n_samples_detailed = .pnt_int,
  sample_cells_total = .pnt_num,
  unassigned_cells = .pnt_num,
  sample_breakdown_complete = .pnt_lgl,
  any_unfiltered = .pnt_lgl,
  n_runs_linked = .pnt_int,
  n_runs_preflightx = .pnt_int,
  n_runs_measurable = .pnt_int,
  has_metadata = .pnt_lgl,
  has_celltype = .pnt_lgl,
  has_donor = .pnt_lgl,
  has_demographics = .pnt_lgl,
  flags = .pnt_list
)

#' Per-sample cell and gene counts for a study
#'
#' Returns one row per sample with matrix dimensions, read-derived species, sex
#' and assay calls, and microbial flags.
#'
#' `cells` counts matrix columns; for unfiltered 10x matrices these are
#' barcodes, so the number is an upper bound and sums overcount.
#'
#' `has_*_reads = NA` means unscreened, `FALSE` means screened with no gated
#' hit. In `flags`, `NULL` and `character(0)` carry the same distinction.
#' `calls_ambiguous` marks a sample whose read-derived calls disagree.
#'
#'
#' @param accession A study or series accession, or one resolving to a study.
#' @param limit Maximum samples; `NULL` reads all, in pages of up to 1000.
#' @param offset Number of samples to skip.
#' @inheritParams project
#'
#' @return A sample tibble, empty when the study is unprocessed. The `study`
#'   and `n_samples_total` attributes carry the study row and its total.
#'
#' @seealso [sample_microbes()] for the per-organism detections behind the
#'   viral and bacterial flags.
#'
#' @export
#' @examples
#' \dontrun{
#' sc <- ProjectSingleCell("GSE168652")
#' sc[, c("sample_accession", "cells", "genes")]
#' attr(sc, "study")$study_cells
#' }
project_single_cell <- function(accession, limit = NULL, offset = 0, con = .con()) {
  .need_api(con, "project_single_cell",
    why = "There is no Pentimento table in the dump."
  )
  check_required(accession)

  path <- paste0("/project/", toupper(trimws(accession)), "/single-cell")
  page_size <- if (is.null(limit)) .pnt_page else min(limit, .pnt_page)
  res <- .api_get(con, path, limit = page_size, offset = offset, null_on = 404L)
  if (is.null(res)) {
    return(.pnt_tibble(list(), .pnt_sample_spec))
  }

  pages <- list(.as_record_list(res$samples))
  n <- length(pages[[1]])
  total <- .pnt_int(res$n_samples_detailed)
  if (!is.na(total)) {
    wanted <- total - offset
    if (!is.null(limit)) wanted <- min(limit, wanted)
    while (n < wanted) {
      nxt <- .api_get(
        con, path,
        limit = min(.pnt_page, wanted - n),
        offset = offset + n, null_on = 404L
      )
      more <- .as_record_list(nxt$samples)
      # A stale total would never terminate.
      if (length(more) == 0) break
      pages[[length(pages) + 1L]] <- more
      n <- n + length(more)
    }
  }

  # Repeated `c()` would be quadratic in the page count.
  records <- unlist(pages, recursive = FALSE, use.names = FALSE)
  out <- .pnt_tibble(records, .pnt_sample_spec)
  attr(out, "study") <- .pnt_tibble(list(res), .pnt_study_spec)
  attr(out, "n_samples_total") <- total
  out
}

.pnt_organism_spec <- list(
  organism = .pnt_chr,
  kingdom = .pnt_chr,
  class = .pnt_chr,
  n_organisms = .pnt_int,
  n_unitigs = .pnt_int,
  kmer_mass = .pnt_num,
  reads = .pnt_num,
  covered_bp = .pnt_num,
  max_breadth_frac = .pnt_num,
  is_validated_viral = .pnt_lgl,
  is_viral_evidence = .pnt_lgl,
  is_validated_bacterial = .pnt_lgl
)

.pnt_detection_spec <- list(
  run_accession = .pnt_chr,
  gsm_accession = .pnt_chr,
  sample_accession = .pnt_chr,
  study_accession = .pnt_chr,
  organism = .pnt_chr,
  kingdom = .pnt_chr,
  class = .pnt_chr,
  measurable = .pnt_lgl,
  total_reads = .pnt_num,
  reads = .pnt_num,
  kmer_mass = .pnt_num,
  n_unitigs = .pnt_int,
  ref_bp = .pnt_num,
  covered_bp = .pnt_num,
  breadth_frac = .pnt_num,
  is_background = .pnt_lgl,
  is_validated_viral = .pnt_lgl,
  is_viral_evidence = .pnt_lgl,
  is_validated_bacterial = .pnt_lgl
)

.pnt_kingdom_spec <- list(
  n_organisms = .pnt_int,
  n_unitigs = .pnt_int,
  kmer_mass = .pnt_num,
  reads = .pnt_num,
  covered_bp = .pnt_num,
  max_breadth_frac = .pnt_num
)

#' Microbial reads found in a sample
#'
#' Returns one row per organism, ordered by k-mer mass.
#'
#' Panel-unitig alignments lack raw-read, UMI and replicate confirmation and are
#' not diagnostic. `measurable` of `FALSE` or `NA` means the sample was never
#' screened, and the function warns when that happens.
#'
#' `kmer_mass` weights k-mers within a run, so it carries no absolute scale.
#' `n_unitigs` counts mapped unitigs.
#'
#' `spike_in_control` (PhiX) and `negative_control` (the papillomavirus that
#' calibrates the viral threshold) are never summed into the viral or bacterial
#' totals; `bacterial_background` is excluded unless `include_background` is set.
#'
#'
#' @param accession A GSM, or the archive sample accession behind one.
#' @param kind Detection class: `"viral"`, `"bacterial"`, `"both"` or `"all"`.
#' @param min_breadth Keep only detections covering at least this fraction of
#'   the reference, overriding the stored gate.
#' @param min_kmer_mass Keep only detections at or above this weighted k-mer
#'   mass.
#' @param validated_only Keep only detections that pass the stored gates.
#' @param include_background Include reagent kitome and skin flora, which are
#'   excluded by default.
#' @param detail Return per-run rows; the organism view stays on the
#'   `by_organism` attribute and costs no second request.
#' @param limit The maximum number of detection rows to read, at most 1000.
#' @inheritParams project
#'
#' @return An organism tibble, or a run-by-organism tibble when
#'   `detail = TRUE`. `measurable`, `n_runs`, `totals`, `by_kingdom`,
#'   `control_kingdoms` and the unpicked view are carried as attributes.
#'
#' @seealso [project_single_cell()] for the study-wide flags.
#'
#' @export
#' @examples
#' \dontrun{
#' m <- SampleMicrobes("GSM5155196", kind = "viral")
#' m[, c("organism", "n_unitigs", "max_breadth_frac")]
#' attr(m, "measurable")
#' attr(m, "detections")
#' }
sample_microbes <- function(accession, kind = c("all", "viral", "bacterial", "both"),
                            min_breadth = NULL, min_kmer_mass = NULL,
                            validated_only = FALSE, include_background = FALSE,
                            detail = FALSE, limit = 500, con = .con()) {
  .need_api(con, "sample_microbes",
    why = "There is no Pentimento table in the dump."
  )
  check_required(accession)
  kind <- match.arg(kind)

  res <- .api_get(
    con, paste0("/sample/", toupper(trimws(accession)), "/microbes"),
    kind = kind, min_breadth = min_breadth, min_kmer_mass = min_kmer_mass,
    validated_only = validated_only, include_background = include_background,
    limit = limit
  )

  organisms <- .pnt_tibble(.as_record_list(res$by_organism), .pnt_organism_spec)
  detections <- .pnt_tibble(.as_record_list(res$detections), .pnt_detection_spec)
  if (detail) {
    out <- detections
    attr(out, "by_organism") <- organisms
  } else {
    out <- organisms
    attr(out, "detections") <- detections
  }

  kingdoms <- res$by_kingdom %||% list()
  by_kingdom <- tibble::as_tibble(c(
    list(kingdom = names(kingdoms) %||% character()),
    .pnt_tibble(unname(kingdoms), .pnt_kingdom_spec)
  ))

  measurable <- .pnt_lgl(res$measurable)
  attr(out, "measurable") <- measurable
  attr(out, "n_runs") <- .pnt_int(res$n_runs)
  attr(out, "totals") <- .pnt_tibble(list(res$totals %||% list()), .pnt_kingdom_spec)
  attr(out, "by_kingdom") <- by_kingdom
  attr(out, "control_kingdoms") <- unlist(res$control_kingdoms %||% list())

  if (is.na(measurable) || !measurable) {
    cli::cli_warn(c(
      "{.val {accession}} was never screened for microbes.",
      i = "The empty result reports missing data, and rules nothing out.",
      i = "See {.code attr(x, \"measurable\")}."
    ))
  }
  out
}
