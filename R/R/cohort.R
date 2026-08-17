#' @noRd
.cohort_filters <- c(
  # substring
  "tissue", "disease", "cell_type", "assay", "assay_category", "phenotype",
  "treatment", "development_stage", "sample_type", "genetic_modification",
  "strain", "cell_line", "ethnicity", "tissue_primary_site",
  # exact, case-insensitive
  "organism", "sex", "taxid", "study_accession",
  # ontology CURIE
  "disease_ontology_id", "tissue_ontology_id", "cell_type_ontology_id",
  "assay_ontology_id", "development_stage_ontology_id",
  # range
  "age_min_years", "age_max_years",
  "min_cell_count", "max_cell_count", "min_gene_count", "max_gene_count",
  # read-derived (Pentimento)
  "single_cell_only", "has_viral_reads", "has_bacterial_reads", "hpv_type",
  "microbe", "microbe_class", "microbe_min_breadth", "microbe_min_kmer_mass",
  "microbe_validated_only"
)

#' @noRd
.cohort_sortable <- c(
  "sample", "study_accession", "age_days", "cell_count", "gene_count"
)

#' /samples/search caps a page at 500 rows.
#' @noRd
.cohort_page <- 500L

#' Keeps the detection objects intact; `.pnt_list` would flatten them to text.
#' @noRd
.cohort_detections <- function(x) if (is.null(x)) list(NULL) else list(x)

#' @noRd
.cohort_spec <- function() {
  list(
    sample = .pnt_chr,
    study_accession = .pnt_chr,
    organism = .pnt_chr,
    taxid = .pnt_chr,
    age = .pnt_chr,
    age_days = .pnt_num,
    sex = .pnt_chr,
    ethnicity = .pnt_chr,
    phenotype = .pnt_chr,
    cell_type = .pnt_chr,
    tissue = .pnt_chr,
    strain = .pnt_chr,
    disease = .pnt_chr,
    assay = .pnt_chr,
    assay_category = .pnt_chr,
    cell_line = .pnt_chr,
    treatment = .pnt_chr,
    development_stage = .pnt_chr,
    sample_type = .pnt_chr,
    genetic_modification = .pnt_chr,
    tissue_primary_site = .pnt_chr,
    tissue_site_type = .pnt_chr,
    cell_count = .pnt_int,
    gene_count = .pnt_int,
    cell_count_estimated = .pnt_int,
    disease_ontology_id = .pnt_chr,
    disease_ontology_name = .pnt_chr,
    tissue_ontology_id = .pnt_chr,
    tissue_ontology_name = .pnt_chr,
    cell_type_ontology_id = .pnt_chr,
    cell_type_ontology_name = .pnt_chr,
    assay_ontology_id = .pnt_chr,
    assay_ontology_name = .pnt_chr,
    development_stage_ontology_id = .pnt_chr,
    development_stage_ontology_name = .pnt_chr,
    cells = .pnt_int,
    genes = .pnt_int,
    pentimento_assay = .pnt_chr,
    assay_is_single_cell = .pnt_lgl,
    hpv_top_type = .pnt_chr,
    hpv_ambiguous = .pnt_lgl,
    has_viral_reads = .pnt_lgl,
    has_bacterial_reads = .pnt_lgl,
    viral_kmer_mass = .pnt_num,
    bacterial_kmer_mass = .pnt_num,
    microbe_n_detections = .pnt_int,
    microbe_max_breadth_frac = .pnt_num,
    microbe_reads = .pnt_int,
    microbe_kmer_mass = .pnt_num,
    microbes_truncated = .pnt_lgl,
    microbes = .cohort_detections
  )
}

#' @noRd
.check_cohort_filters <- function(filters) {
  if (is.null(names(filters)) || any(!nzchar(names(filters)))) {
    cli::cli_abort("Give every filter by name.")
  }
  bad <- setdiff(names(filters), .cohort_filters)
  if (length(bad) == 0) {
    return(invisible(NULL))
  }
  d <- utils::adist(bad, .cohort_filters, ignore.case = TRUE)
  near <- .cohort_filters[colSums(d <= 2) > 0]
  cli::cli_abort(c(
    "Unknown sample filter{?s}: {.val {bad}}.",
    i = if (length(near)) "Did you mean {.val {near}}?",
    i = "See {.code ?sample_search} for the filters."
  ))
}

#' Search samples across every project
#'
#' Searches the harmonised data, not the submitter's free text. SeqOut reads
#' each sample's description and writes the tissue, the disease, the cell type,
#' the assay and the age into one vocabulary, so one filter reaches every study
#' that recorded the fact, whatever words its submitter used. A sample that was
#' never harmonised cannot be found here.
#'
#' \describe{
#'   \item{Substring}{`tissue`, `disease`, `cell_type`, `assay`,
#'     `assay_category`, `phenotype`, `treatment`, `development_stage`,
#'     `sample_type`, `genetic_modification`, `strain`, `cell_line`,
#'     `ethnicity`, `tissue_primary_site`. `"liver"` matches
#'     `"liver, left lobe"`.}
#'   \item{Exact}{`organism`, `sex`, `taxid`, `study_accession`. These compare
#'     case-insensitively and never as a substring, because `"male"` as a
#'     substring also matches `"female"`.}
#'   \item{Harmonised ontology ID}{`disease_ontology_id`, `tissue_ontology_id`,
#'     `cell_type_ontology_id`, `assay_ontology_id`,
#'     `development_stage_ontology_id`. Give a CURIE such as
#'     `"MONDO:0005061"`. See `include_descendants`.}
#'   \item{Range}{`age_min_years`, `age_max_years`, `min_cell_count`,
#'     `max_cell_count`, `min_gene_count`, `max_gene_count`. An age filter
#'     excludes a sample whose age was never recorded, so `age_min_years = 0`
#'     means "has a recorded age".}
#'   \item{Read-derived}{`single_cell_only`, `has_viral_reads`,
#'     `has_bacterial_reads`, `hpv_type`, `microbe`, `microbe_class`,
#'     `microbe_min_breadth`, `microbe_min_kmer_mass`,
#'     `microbe_validated_only`. These come from the Pentimento screen of the
#'     reads themselves, which often disagrees with what the submitter
#'     declared.}
#' }
#'
#' A `microbe*` filter narrows the cohort to the samples that carry a
#' matching detection, and attaches the detections to each row. That is what
#' makes "cervical single-cell RNA-seq with HPV quantification" one call rather
#' than a cohort search followed by one [sample_microbes()] call per sample.
#'
#' Requires REST. The harmonised sample table is absent from the Parquet dump.
#'
#' @param ... The filters, by name, from the set above. At least one is
#'   required; an unfiltered call would return the whole corpus.
#' @param include_descendants Expand an ontology filter through the ontology
#'   graph, so `disease_ontology_id = "MONDO:0005061"` also matches the subtypes
#'   of that term. `TRUE` by default. Set `FALSE` for the exact term only.
#' @param sort `"sample"` (the default), `"study_accession"`, `"age_days"`,
#'   `"cell_count"` or `"gene_count"`.
#' @param order `"asc"`, the default, or `"desc"`.
#' @param limit The maximum number of samples. The default, `NULL`, returns
#'   every match.
#' @inheritParams project
#'
#' @return A tibble of samples, one row each, with a `total` attribute holding
#'   the size of the whole cohort and a `filters` attribute holding the filters
#'   the server applied.
#'
#' @seealso [sample_microbes()] for every detection in one sample,
#'   [seqout_search()] when the answer should be projects.
#'
#' @export
#' @examples
#' \dontrun{
#' # Female human liver samples over 50, with the sample accessions
#' SampleSearch(
#'   organism = "Homo sapiens", sex = "female",
#'   tissue = "liver", age_min_years = 50
#' )
#'
#' # Cervical samples with HPV quantification, in one call. The screening
#' # reference names organisms HPV16, HPV18 and so on, so search "HPV".
#' # "papillomavirus" matches nothing.
#' hpv <- SampleSearch(
#'   tissue = "cervix", microbe = "HPV",
#'   sort = "cell_count", order = "desc"
#' )
#' attr(hpv, "total")
#'
#' # An ontology term and its subtypes
#' SampleSearch(disease_ontology_id = "MONDO:0005061", limit = 100)
#'
#' # The exact term only
#' SampleSearch(
#'   disease_ontology_id = "MONDO:0005061",
#'   include_descendants = FALSE, limit = 100
#' )
#' }
sample_search <- function(..., include_descendants = TRUE, sort = "sample",
                          order = "asc", limit = NULL, con = .con()) {
  .need_api(
    con, "sample_search",
    why = "The harmonised sample table is not in the dump."
  )
  sort <- match.arg(sort, .cohort_sortable)
  order <- match.arg(order, c("asc", "desc"))

  filters <- .compact(list(...))
  if (length(filters) == 0) {
    cli::cli_abort(c(
      "Give at least one filter.",
      i = "An unfiltered search would return every annotated sample."
    ))
  }
  .check_cohort_filters(filters)

  if (!is.null(limit)) limit <- max(1L, as.integer(limit))

  pages <- list()
  n <- 0L
  offset <- 0L
  repeat {
    want <- if (is.null(limit)) .cohort_page else min(.cohort_page, limit - n)
    res <- do.call(.api_get, c(
      list(con = con, path = "/samples/search"),
      filters,
      list(
        include_descendants = include_descendants,
        sort = sort, order = order, limit = want, offset = offset
      )
    ))
    page <- .as_record_list(res$samples)
    pages[[length(pages) + 1L]] <- page
    n <- n + length(page)

    nxt <- res$next_offset
    # A stale next_offset would never terminate.
    if (is.null(nxt) || length(page) == 0) break
    if (!is.null(limit) && n >= limit) break
    offset <- as.integer(nxt)
  }

  # Repeated `c()` would be quadratic in the page count.
  rows <- unlist(pages, recursive = FALSE, use.names = FALSE)
  # Defend against a server that exceeds the requested limit.
  if (!is.null(limit) && length(rows) > limit) {
    rows <- rows[seq_len(limit)]
  }
  out <- .pnt_tibble(rows, .cohort_spec())
  # total and filters repeat on every page.
  attr(out, "total") <- .pnt_int(res$total)
  attr(out, "filters") <- res$filters
  out
}
