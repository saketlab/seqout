# GEO fixtures for counts readers across archive formats.

gse_record <- function(accession, label, organism, tissue, formats,
                       min_units, min_samples, assays = character(),
                       multimodal_samples = 0L,
                       modal = c("single", "paired", "split", "series"),
                       samples = character(), only_na_assay = FALSE) {
  list(
    accession = accession,
    label = label,
    organism = organism,
    tissue = tissue,
    formats = formats,
    assays = assays,
    min_units = min_units,
    min_samples = min_samples,
    multimodal_samples = multimodal_samples,
    modal = match.arg(modal),
    samples = samples,
    only_na_assay = only_na_assay
  )
}

gse_catalogue <- list(
  gse_record(
    "GSE297547", "CITE-seq, h5ad per sample", "Homo sapiens", "PBMC",
    "h5ad", 39L, 19L, c("adt", "rna"), 19L, "paired",
    c("GSM8994520", "GSM8994523")
  ),
  gse_record(
    "GSE139369", "MPAL CITE-seq, rds per modality", "Homo sapiens",
    "bone marrow and peripheral blood", "rds", 33L, 16L,
    c("adt", "rna"), 16L, "paired", "GSM4138872"
  ),
  gse_record(
    "GSE158013", "TEA-seq, trimodal in one sample", "Homo sapiens",
    "blood and bone marrow", c("10x_h5", "table", "tar"), 50L, 34L,
    c("adt", "atac", "rna"), 2L, "paired", "GSM4949911"
  ),
  gse_record(
    "GSE156478", "DOGMA-seq, multiome and protein GSMs", "Homo sapiens; Mus musculus",
    "bone marrow", c("10x_mtx", "table", "tar"), 35L, 34L,
    c("adt", "hto", "rna"), 0L, "split", c("GSM5065525", "GSM5065526")
  ),
  gse_record(
    "GSE164378", "CITE-seq modalities on separate GSMs", "Homo sapiens",
    "blood", c("10x_mtx", "tar"), 7L, 6L, c("adt", "hto", "rna"),
    modal = "split"
  ),
  gse_record(
    "GSE128639", "table modalities on separate GSMs", "Homo sapiens",
    "blood", c("table", "tar"), 6L, 4L, c("adt", "hto", "rna"),
    modal = "split"
  ),
  gse_record(
    "GSE126310", "ADT and HTO tables on separate GSMs", "Homo sapiens; Mus musculus",
    "blood", c("table", "tar"), 25L, 24L, c("adt", "hto"),
    modal = "split"
  ),
  gse_record(
    "GSE166188", "10x and table modalities on separate GSMs", "Homo sapiens",
    "blood", c("10x_mtx", "table", "tar"), 13L, 12L, c("adt", "rna"),
    modal = "split"
  ),
  gse_record(
    "GSE178707", "multi-format modalities on separate GSMs", "Homo sapiens; Mus musculus",
    "blood and bone marrow", c("10x_h5", "10x_mtx", "rds", "table", "tar"),
    20L, 12L, c("adt", "atac", "hto", "rna"),
    modal = "split"
  ),
  gse_record(
    "GSE162170", "series-level cortex RNA and ATAC tables", "Homo sapiens",
    "cerebral cortex", "table", 18L, 0L, c("atac", "rna"),
    modal = "series"
  ),
  gse_record(
    "GSE200046", "series-level multiome files beside samples", "Homo sapiens",
    "bone marrow", c("10x_h5", "h5ad", "tar"), 9L, 4L, c("atac", "rna"),
    modal = "series"
  ),
  gse_record(
    "GSE192780", "10x mtx without modality words", "Homo sapiens",
    "blood", c("10x_mtx", "tar"), 9L, 8L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE291735", "small 10x mtx series", "Homo sapiens",
    "blood", c("10x_mtx", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE150599", "mouse 10x h5 and mtx spleen series", "Mus musculus",
    "spleen and lymph nodes", c("10x_h5", "10x_mtx", "tar"), 11L, 4L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE166797", "small 10x h5 series", "Homo sapiens",
    "blood", c("10x_h5", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE173319", "10x h5 bone marrow series", "Homo sapiens",
    "bone marrow", c("10x_h5", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE182159", "table series with blood and liver samples", "Homo sapiens",
    "blood and liver", c("table", "tar"), 47L, 46L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE176078", "primary breast tumor tar and table series", "Homo sapiens",
    "primary breast tumor", c("table", "tar"), 29L, 26L, "rna"
  ),
  gse_record(
    "GSE60931", "skeletal muscle bulk RNA-seq tables", "Mus musculus",
    "extensor digitorum longus muscle", c("table", "tar"), 31L, 30L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE157377", "mouse lung lipofibroblast-like cells", "Mus musculus",
    "lung lipofibroblast-like cells", c("10x_mtx", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE228737", "zebrafish epidermal cells", "Danio rerio",
    "epidermis", c("10x_mtx", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE138625", "Drosophila wing disc Chromium 10x", "Drosophila melanogaster",
    "wing discs", c("10x_mtx", "tar"), 5L, 4L, "rna"
  ),
  gse_record(
    "GSE235495", "Arabidopsis root tip scRNA-seq", "Arabidopsis thaliana",
    "root", c("10x_mtx", "tar"), 5L, 4L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE157757", "maize seedling leaf scRNA-seq", "Zea mays",
    "seedling leaf", c("10x_mtx", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE77944", "C. elegans early embryo single-cell tables", "Caenorhabditis elegans",
    "embryo", c("table", "tar"), 220L, 219L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE272669", "rhesus macaque brain myeloid cells", "Macaca mulatta",
    "brain", c("10x_h5", "tar"), 5L, 4L, "rna"
  ),
  gse_record(
    "GSE293074", "rat intestine and blood immune cells", "Rattus norvegicus",
    "small intestine and blood", c("10x_mtx", "tar"), 15L, 14L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE247625", "rat lung cells in pulmonary hypertension", "Rattus norvegicus",
    "lung", c("10x_h5", "tar"), 9L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE300150", "ependymoma tumor cell heterogeneity", "Homo sapiens; Rattus norvegicus",
    "ependymoma tumor", c("10x_mtx", "table", "tar"), 110L, 55L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE166561", "porcine skin cells", "Sus scrofa",
    "skin", c("10x_mtx", "tar"), 3L, 2L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE171649", "chick hypothalamic development", "Gallus gallus",
    "hypothalamus", c("10x_h5", "tar"), 9L, 8L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE201386", "yeast stress single-cell expression", "Saccharomyces cerevisiae",
    "yeast cells under stress", c("table", "tar"), 118L, 117L,
    only_na_assay = TRUE
  ),
  gse_record(
    "GSE195790", "Xenopus multi-tissue cell landscape", "Xenopus laevis",
    "stomach, intestine, kidney, lung, brain and heart", c("table", "tar"),
    57L, 56L,
    only_na_assay = TRUE
  )
)

gse_by_accession <- function(accession) {
  hits <- Filter(function(spec) identical(spec$accession, accession), gse_catalogue)
  stopifnot(length(hits) == 1L)
  hits[[1]]
}

gse_with_modal <- function(modal) {
  Filter(function(spec) identical(spec$modal, modal), gse_catalogue)
}

gse_with_assays <- function() {
  Filter(function(spec) length(spec$assays) > 0L, gse_catalogue)
}

skip_unless_live <- function() {
  skip_on_cran()
  skip_if_offline()
}

# Reading a unit needs the readers the format is stored in.
skip_unless_readable <- function(formats) {
  if (any(formats %in% c("10x_h5", "h5ad"))) skip_if_not_installed("hdf5r")
  skip_if_not_installed("Matrix")
}

# Skip live checks when the server fails or the connection drops.
live <- function(expr) {
  tryCatch(expr, error = function(e) {
    msg <- conditionMessage(e)
    if (grepl("API error|HTTP|timed out|resolve host|Connection|SSL", msg)) {
      skip(paste("live API unavailable:", msg))
    }
    stop(e)
  })
}

gse_counts_cache <- new.env(parent = emptyenv())

counts_of <- function(accession) {
  key <- toupper(trimws(accession))
  if (!exists(key, envir = gse_counts_cache, inherits = FALSE)) {
    assign(key, live(seqout_counts(key, assay = NULL)), envir = gse_counts_cache)
  }
  get(key, envir = gse_counts_cache, inherits = FALSE)
}

modalities_per_sample <- function(counts) {
  keyed <- counts[!is.na(counts$sample), , drop = FALSE]
  vapply(
    split(keyed$assay, keyed$sample),
    function(a) length(unique(stats::na.omit(a))),
    integer(1)
  )
}
