#' @noRd
.spt_summary_spec <- function() {
  list(
    studies = .pnt_int, studies_named_platform = .pnt_int,
    studies_single_cell_res = .pnt_int, studies_spot_res = .pnt_int,
    studies_roi_res = .pnt_int,
    studies_with_matrix = .pnt_int, studies_with_fastq = .pnt_int,
    studies_matrix_and_fastq = .pnt_int, studies_human = .pnt_int,
    samples = .pnt_int,
    # corpus-wide cell sums can pass 2^31
    cells = .pnt_num,
    first_year = .pnt_int, last_year = .pnt_int
  )
}

#' @noRd
.spt_project_spec <- function() {
  c(.sc_evidence_project_spec(), list(
    platforms = .pnt_list, resolution = .pnt_chr, technology = .pnt_chr,
    country = .pnt_chr, pmid = .pnt_chr, year = .pnt_int
  ))
}

#' Spatial transcriptomics corpus totals
#'
#' Totals for studies flagged single-cell modality "Spatial Transcriptomics",
#' the same population [spatial_projects()] lists. `studies_named_platform`
#' counts studies whose own text names a specific platform (Visium, Xenium,
#' MERFISH, ...); the rest only say "spatial transcriptomics" generically.
#'
#' @inheritParams project
#' @return A one-row tibble of totals.
#'
#' @seealso [spatial_facets()] for the filter values,
#'   [spatial_projects()] for the studies themselves.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' SpatialSummary()
spatial_summary <- function(con = .con()) {
  .need_api(con, "spatial_summary",
    why = "There is no spatial collection table in the dump."
  )
  .simple_summary(con, "/spatial/summary", .spt_summary_spec())
}

#' Spatial transcriptomics facet counts
#'
#' Study counts per platform, resolution, data availability, organism,
#' tissue, readout assay, cell line, sample type and year. Each facet holds
#' its top 100 values.
#'
#' @inheritParams project
#' @return A tibble with `facet`, `value` and `studies` columns.
#'
#' @seealso [spatial_projects()].
#'
#' @export
#' @examplesIf SeqoutOnline()
#' f <- SpatialFacets()
#' f[f$facet == "platform", ]
spatial_facets <- function(con = .con()) {
  .need_api(con, "spatial_facets",
    why = "There is no spatial collection table in the dump."
  )
  .simple_facets(con, "/spatial/facets")
}

#' Spatial transcriptomics studies
#'
#' One row per study the modality classifier flags "Spatial Transcriptomics".
#' The platform is named by regex over the study's own text (Visium, Xenium,
#' MERFISH, CosMx, Slide-seq, Slide-seqV2, Curio Seeker, Stereo-seq, GeoMx DSP,
#' DBiT-seq, STARmap, osmFISH, HDST, Tomo-seq, Pixel-seq, Molecular
#' Cartography).
#'
#' `platforms` is empty when the text never names a platform. A named
#' platform is a text mention: a comparison paper can name one it did not run.
#'
#' `resolution` groups platforms into `"single-cell"` (Xenium, MERFISH,
#' CosMx, seqFISH, STARmap, osmFISH, Molecular Cartography), `"spot"`
#' (coarser than single-cell: Visium, Slide-seq, Curio Seeker, Stereo-seq,
#' DBiT-seq, HDST, Tomo-seq, Pixel-seq) or `"roi"` (GeoMx DSP,
#' region-of-interest, not single-cell resolution despite reaching this
#' population). `technology` is `"imaging"`, `"sequencing"` or `"hybrid"`
#' (GeoMx DSP: optical ROI selection, sequencing/nCounter readout); it
#' currently tracks `resolution` one-to-one but is stored separately. A study
#' naming platforms from two groups (e.g. a GeoMx-vs-Xenium
#' comparison) collapses both columns to whichever group is checked first
#' (single-cell/imaging, then spot/sequencing, then roi/hybrid);
#' `platforms` still lists every name found. `data_availability` is
#' `"both"`, `"matrix_only"`, `"fastq_only"` or `"neither"`, from
#' `has_matrix` and `has_fastq`. Filter values come from [spatial_facets()].
#'
#' @param platform Character. One value from [spatial_facets()] (Visium,
#'   Xenium, MERFISH, ...).
#' @param resolution One of `"single-cell"`, `"spot"`, `"roi"`.
#' @param technology One of `"imaging"`, `"sequencing"`, `"hybrid"`.
#' @param data_availability One of `"both"`, `"matrix_only"`, `"fastq_only"`,
#'   `"neither"`.
#' @param organism,tissue,readout_assay,cell_line,sample_type
#'   Character. Filter to one value from [spatial_facets()].
#' @param year Integer. Publication year.
#' @param has_matrix,has_fastq,is_long_read Logical filters.
#' @param q Character. Case-insensitive substring match on title or
#'   study_accession.
#' @param sort One of `"year"`, the default, `"n_samples"`, `"n_cells"`,
#'   `"title"`, `"study_accession"`, `"organism"`.
#' @param order `"desc"`, the default, or `"asc"`.
#' @param limit Maximum studies; `NULL` reads all, in pages of up to 200.
#' @param offset Number of studies to skip.
#' @inheritParams project
#'
#' @return A study tibble, with a `total` attribute for the filtered count
#'   before `limit` cut it.
#'
#' @seealso [spatial_summary()], [spatial_facets()],
#'   [seqout_counts()] to read the matrices of a study with `has_matrix`.
#'
#' @export
#' @examplesIf SeqoutOnline()
#' # Xenium studies in human
#' SpatialProjects(platform = "Xenium", organism = "Homo sapiens", limit = 10)
#'
#' # single-cell-resolution spatial studies with both a matrix and FASTQ
#' SpatialProjects(
#'   resolution = "single-cell", data_availability = "both", limit = 10
#' )
spatial_projects <- function(platform = NULL, resolution = NULL,
                             technology = NULL,
                             data_availability = NULL,
                             organism = NULL, tissue = NULL,
                             readout_assay = NULL, cell_line = NULL,
                             sample_type = NULL, year = NULL,
                             has_matrix = NULL, has_fastq = NULL,
                             is_long_read = NULL,
                             q = NULL, sort = "year", order = "desc",
                             limit = NULL, offset = 0, con = .con()) {
  .need_api(con, "spatial_projects",
    why = "There is no spatial collection table in the dump."
  )
  params <- .lower_bools(list(
    platform = platform, resolution = resolution, technology = technology,
    data_availability = data_availability,
    organism = organism, tissue = tissue, readout_assay = readout_assay,
    cell_line = cell_line, sample_type = sample_type, year = year,
    has_matrix = has_matrix, has_fastq = has_fastq,
    is_long_read = is_long_read,
    q = q, sort = sort, order = order
  ))
  .walk_pages(con, "/spatial/projects", params, .spt_project_spec(), limit, offset)
}
