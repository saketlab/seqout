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
  "has_matrix", "single_cell_only", "has_viral_reads", "has_bacterial_reads",
  "hpv_type",
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

#' Keep detection objects; `.pnt_list` would flatten them.
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

#' Search samples across every project
#'
#' Searches harmonised sample metadata. Unharmonised samples are absent.
#'
#' \describe{
#'   \item{Substring}{`tissue`, `disease`, `cell_type`, `assay`,
#'     `assay_category`, `phenotype`, `treatment`, `development_stage`,
#'     `sample_type`, `genetic_modification`, `strain`, `cell_line`,
#'     `ethnicity`, `tissue_primary_site`. `"liver"` matches
#'     `"liver, left lobe"`.}
#'   \item{Exact}{`organism`, `sex`, `taxid`, `study_accession`.
#'     Exact matching keeps `"male"` from matching `"female"`.}
#'   \item{Harmonised ontology ID}{`disease_ontology_id`, `tissue_ontology_id`,
#'     `cell_type_ontology_id`, `assay_ontology_id`,
#'     `development_stage_ontology_id`. Give a CURIE such as
#'     `"MONDO:0005061"`. See `include_descendants`.}
#'   \item{Range}{`age_min_years`, `age_max_years`, `min_cell_count`,
#'     `max_cell_count`, `min_gene_count`, `max_gene_count`. An age filter
#'     excludes a sample without a recorded age, so `age_min_years = 0`
#'     means "has a recorded age".}
#'   \item{Matrix}{`has_matrix` keeps samples with a parsed cell-by-gene
#'     matrix.}
#'   \item{Read-derived}{`single_cell_only` (but see `single_cell`),
#'     `has_viral_reads`, `has_bacterial_reads`, `hpv_type`, `microbe`,
#'     `microbe_class`, `microbe_min_breadth`, `microbe_min_kmer_mass`,
#'     `microbe_validated_only`.}
#' }
#'
#' A `microbe*` filter keeps samples with matching detections and attaches them.
#'
#' Requires REST. The harmonised sample table is absent from the Parquet dump.
#'
#' @param filters Filters as a named list. Names in `...` override it.
#' @param ... The filters, by name, from the set above. At least one is
#'   required, here or in `filters`; an unfiltered call returns the whole corpus.
#' @param single_cell How to decide a sample is single-cell: `"assay"` reads
#'   assay text, `"flag"` reads `assay_is_single_cell`, `"either"` accepts both.
#'   `NULL`, the default, does not filter.
#'
#'   `"flag"` (and `single_cell_only`) drops samples with `NA` flags.
#'   `"assay"` and `"either"` read every page and filter locally.
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
#' @return A sample tibble with `total` and `filters` attributes.
#'
#' @seealso [sample_microbes()] for every detection in one sample,
#'   [seqout_search()] when the answer should be projects.
#'
#' @export
#' @examples
#' \dontrun{
#' # single-cell samples by assay text
#' SampleSearch(tissue = "liver", disease = "steato", single_cell = "assay")
#'
#' # female human liver samples over 50
#' SampleSearch(
#'   organism = "Homo sapiens", sex = "female",
#'   tissue = "liver", age_min_years = 50
#' )
#'
#' # HPV references use HPV16, HPV18, and related names
#' # "papillomavirus" matches nothing
#' hpv <- SampleSearch(
#'   tissue = "cervix", microbe = "HPV",
#'   sort = "cell_count", order = "desc"
#' )
#' attr(hpv, "total")
#'
#' # filters built in code
#' list(tissue = "cervix", microbe = "HPV") |> SampleSearch()
#'
#' # ontology term and subtypes
#' SampleSearch(disease_ontology_id = "MONDO:0005061", limit = 100)
#'
#' # exact term
#' SampleSearch(
#'   disease_ontology_id = "MONDO:0005061",
#'   include_descendants = FALSE, limit = 100
#' )
#' }
sample_search <- function(filters = NULL, ..., single_cell = NULL,
                          include_descendants = TRUE,
                          sort = "sample", order = "asc", limit = NULL,
                          con = .con()) {
  .need_api(
    con, "sample_search",
    why = "The harmonised sample table is not in the dump."
  )
  sort <- match.arg(sort, .cohort_sortable)
  order <- match.arg(order, c("asc", "desc"))
  if (!is.null(single_cell)) {
    single_cell <- match.arg(single_cell, c("assay", "flag", "either"))
  }

  if (!is.null(filters) && !is.list(filters)) {
    # a bare value here is an unnamed filter
    filters <- as.list(filters)
  }
  # flat override; modifyList() would merge list-valued filters and drop the
  # unnamed entries .check_filter_names() reports
  dots <- list(...)
  filters <- filters %||% list()
  nms <- names(filters) %||% rep("", length(filters))
  filters <- .compact(c(filters[!nzchar(nms) | !(nms %in% names(dots))], dots))
  if (length(filters) == 0) {
    cli::cli_abort(c(
      "Give at least one filter.",
      i = "An unfiltered search would return every annotated sample."
    ))
  }
  .check_filter_names(
    filters, .cohort_filters, "sample filter",
    help = "See {.code ?sample_search} for the filters."
  )
  if (!is.null(single_cell) && !is.null(filters$single_cell_only)) {
    cli::cli_abort(c(
      "Give {.arg single_cell} or {.arg single_cell_only}, not both.",
      i = "{.arg single_cell_only} is {.arg single_cell = \"flag\"}."
    ))
  }
  # flag filters server-side; assay routes need unfiltered rows
  if (identical(single_cell, "flag")) {
    filters$single_cell_only <- TRUE
    single_cell <- NULL
  }
  if (isTRUE(filters$single_cell_only)) {
    .warn_unscored_single_cell()
  }

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
    # stale next_offset would loop forever
    if (is.null(nxt) || length(page) == 0) break
    if (!is.null(limit) && n >= limit) break
    offset <- as.integer(nxt)
  }

  # repeated c() would be quadratic in the page count
  rows <- unlist(pages, recursive = FALSE, use.names = FALSE)
  # cap rows if the server exceeds limit
  if (!is.null(limit) && length(rows) > limit) {
    rows <- rows[seq_len(limit)]
  }
  out <- .pnt_tibble(rows, .cohort_spec())
  # total and filters repeat on every page
  attr(out, "total") <- .pnt_int(res$total)
  attr(out, "filters") <- res$filters

  if (!is.null(single_cell)) {
    keep <- .cohort_is_single_cell(out, single_cell)
    total <- attr(out, "total")
    filt <- attr(out, "filters")
    out <- out[keep, , drop = FALSE]
    attr(out, "total") <- total
    attr(out, "filters") <- filt
  }
  out
}

#' Single-cell calls by route
#'
#' `assay_is_single_cell` is sparse; assay strings cover those samples.
#' @noRd
.cohort_is_single_cell <- function(out, how) {
  by_assay <- grepl(
    .cohort_sc_assay,
    paste(out$assay, out$assay_ontology_name),
    ignore.case = TRUE
  )
  by_flag <- !is.na(out$assay_is_single_cell) & out$assay_is_single_cell
  switch(how,
    assay = by_assay,
    either = by_assay | by_flag,
    by_flag
  )
}

#' The assay spellings that mean single-cell or single-nucleus
#' @noRd
.cohort_sc_assay <- paste0(
  "sc|sn|single.?(cell|nucleus)|10x|chromium|",
  "smart.?seq|drop.?seq|visium|slide.?seq"
)

#' Warn on sparse single-cell flags
#'
#' Unscored samples are absent from the response, so warn once.
#' @noRd
.warn_unscored_single_cell <- function() {
  cli::cli_warn(
    c(
      "{.arg single_cell_only} filters on {.field assay_is_single_cell}, which
       is {.val NA} for most samples.",
      i = "Samples the server never scored are absent from the result rather
           than flagged, including whole studies that are plainly single-cell.",
      i = "{.code single_cell = \"assay\"} selects on the assay string instead,
           and {.code \"either\"} accepts both."
    ),
    .frequency = "once",
    .frequency_id = "seqout_single_cell_only_unscored"
  )
}

#' The microbial detections behind a cohort, one row each
#'
#' Flattens the `microbes` list column from [sample_search()] into one row
#' per (sample, organism, run).
#'
#' @param x A sample tibble from [sample_search()], carrying `microbes`.
#' @param validated_only Keep only detections that pass the stored gates.
#' @param columns Detection fields to keep. The default set covers the organism,
#'   its class and the two evidence measures.
#'
#' @return A tibble of `sample` plus the requested detection fields, empty when
#'   nothing was detected.
#'
#' @seealso [sample_search()] for the samples, [sample_microbes()] for every
#'   detection in one sample.
#'
#' @export
#' @examples
#' \dontrun{
#' hpv <- SampleSearch(disease_ontology_id = "MONDO:0002974", microbe = "HPV")
#' d <- MicrobeDetections(hpv)
#' sort(table(d$organism), decreasing = TRUE)
#'
#' # only the detections that pass the gates
#' MicrobeDetections(hpv, validated_only = TRUE)
#' }
microbe_detections <- function(x, validated_only = FALSE,
                               columns = c(
                                 "organism", "class", "kingdom",
                                 "breadth_frac", "kmer_mass"
                               )) {
  if (!is.data.frame(x) || !"microbes" %in% names(x)) {
    cli::cli_abort(c(
      "{.arg x} must be a sample tibble carrying a {.field microbes} column.",
      i = "{.fn sample_search} adds one when a {.arg microbe*} filter is given."
    ))
  }
  samples <- x[["sample"]] %||% rep(NA_character_, nrow(x))
  rows <- Map(function(sample, detections) {
    if (!length(detections)) {
      return(NULL)
    }
    if (isTRUE(validated_only)) {
      detections <- Filter(function(d) {
        isTRUE(d$is_validated_viral) ||
          isTRUE(d$is_validated_bacterial)
      }, detections)
    }
    if (!length(detections)) {
      return(NULL)
    }
    out <- lapply(columns, function(nm) {
      vapply(detections, function(d) .scalar_or_na(d[[nm]]), character(1))
    })
    names(out) <- columns
    tibble::as_tibble(c(list(sample = rep(sample, length(detections))), out))
  }, samples, x[["microbes"]])

  rows <- Filter(Negate(is.null), rows)
  if (!length(rows)) {
    return(tibble::tibble(sample = character(), !!!stats::setNames(
      rep(list(character()), length(columns)), columns
    )))
  }
  out <- do.call(rbind, rows)
  # Restore numeric fields after the character round trip.
  for (nm in intersect(c("breadth_frac", "kmer_mass"), names(out))) {
    out[[nm]] <- suppressWarnings(as.numeric(out[[nm]]))
  }
  out
}

#' @noRd
.scalar_or_na <- function(value) {
  if (is.null(value) || length(value) != 1L) NA_character_ else as.character(value)
}
