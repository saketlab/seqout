#' File-role classification for GEO supplementary files
#'
#' Mirrors the Python client role names.
#' @noRd
NULL

#' @noRd
.meta_name_hints <- c(
  "metadata", "meta_data", "meta-data", "meta.data", "_meta.", ".meta.",
  "cell_meta", "cellmeta", "annotation", "annot", "celltype", "cell_type",
  "cell.type", "cell_label", "phenotype", "pdata", "obs.csv", "obs.tsv"
)

#' @noRd
.counts_name_hints <- c(
  "count", "matrix", "expr", "umi", "tpm", "fpkm", "cpm", "rpkm", "dge"
)

#' @noRd
.embedded_metadata_formats <- c("rds", "h5ad")

#' Whether a file name is an ATAC fragments file
#'
#' Submitters spell it fragments.tsv.gz, atac_fragments.tsv.gz,
#' filtered-fragments.tsv.gz and .atac.fragments.bed.gz.
#' @noRd
.is_fragments <- function(names) {
  low <- tolower(names)
  grepl("fragments", low, fixed = TRUE) &
    grepl("[.](tsv|bed|txt)([.](gz|bgz))?$", low)
}

.sidecar_names <- c(
  "readme", "md5sum",
  "tissue_positions", "scalefactors", "web_summary", "metrics_summary"
)

#' @noRd
.barcode_names <- c(
  "barcodes.tsv", "barcodes.csv", "barcodes.txt", "_barcodes.", ".barcodes."
)

#' @noRd
# Protein panels use proteins as row labels; the accessibility atlas uses .txt.
# Consensus peak lists also use peaks.bed, so that suffix stays a standalone table.
.feature_names <- c(
  "features.tsv", "genes.tsv", "features.csv", "genes.csv",
  "features.txt", "genes.txt",
  "proteins.tsv", "proteins.csv", ".proteins.", "_proteins."
)

#' @noRd
# specific before generic: the loop keeps the first token a name ends with,
# so matrix.mtx must precede the bare mtx
.role_tokens <- c(
  "matrix.mtx", "barcodes.tsv", "features.tsv", "genes.tsv",
  "barcodes.csv", "features.csv", "genes.csv", "matrix.csv",
  "barcodes.txt", "features.txt", "genes.txt",
  "proteins.tsv", "proteins.csv", "proteins.txt", "mtx"
)

#' @noRd
.tenx_dir_pattern <- "(filtered|raw)_(feature_bc_matrix|gene_bc_matrices)"

#' @noRd
.has_any <- function(x, needles) {
  out <- rep(FALSE, length(x))
  for (needle in needles) {
    out <- out | grepl(needle, x, fixed = TRUE)
  }
  out
}

#' `endsWith()` returns `NA` for an `NA` name; `grepl()` returns `FALSE`.
#' @noRd
.ends_any <- function(x, suffixes) {
  out <- rep(FALSE, length(x))
  known <- !is.na(x)
  for (suffix in suffixes) {
    out <- out | (known & endsWith(x, suffix))
  }
  out
}

#' @noRd
.strip_compression <- function(x) {
  sub("\\.(gz|bz2)$", "", x)
}

#' What a supplementary file is
#'
#' Names the role from the filename, before download.
#'
#' @param name A file name or URL.
#'
#' @return One of `"mtx"`, `"barcodes"`, `"features"`, `"h5"`, `"h5ad"`,
#'   `"rds"`, `"table"`, `"tar"`, `"metadata"` or `"skip"`.
#'
#' @export
#' @examples
#' FileRole("GSM123_matrix.mtx.gz")
#' FileRole("GSM123_barcodes.tsv.gz")
#' FileRole("GSE1_cell_metadata.csv.gz")
#' FileRole("GSM1_fragments.tsv.gz")
file_role <- function(name) {
  low <- tolower(basename(name))
  stem <- .strip_compression(low)
  role <- rep("skip", length(low))
  todo <- rep(TRUE, length(low))

  hit <- todo & .has_any(low, .barcode_names)
  role[hit] <- "barcodes"
  todo[hit] <- FALSE

  hit <- todo & .has_any(low, .feature_names)
  role[hit] <- "features"
  todo[hit] <- FALSE

  hit <- todo & .has_any(stem, ".mtx")
  role[hit] <- "mtx"
  todo[hit] <- FALSE

  hit <- todo &
    .ends_any(stem, c(".csv", ".tsv", ".txt", ".rds", ".rda")) &
    .has_any(low, .meta_name_hints) &
    !.has_any(low, .counts_name_hints)
  role[hit] <- "metadata"
  todo[hit] <- FALSE

  # fragments go through .is_fragments so the two spellings cannot diverge
  hit <- todo & (.has_any(low, .sidecar_names) | .is_fragments(low))
  todo[hit] <- FALSE

  hit <- todo & .ends_any(stem, ".h5ad")
  role[hit] <- "h5ad"
  todo[hit] <- FALSE

  hit <- todo & .ends_any(stem, c(".h5", ".hdf5"))
  role[hit] <- "h5"
  todo[hit] <- FALSE

  hit <- todo & .ends_any(stem, c(".rds", ".rda", ".rdata"))
  role[hit] <- "rds"
  todo[hit] <- FALSE

  hit <- todo & (.has_any(stem, ".tar") | .ends_any(stem, ".tgz"))
  role[hit] <- "tar"
  todo[hit] <- FALSE

  hit <- todo & .ends_any(stem, c(".csv", ".tsv", ".txt"))
  role[hit] <- "table"

  role
}

#' Shared key for the files of one 10x unit
#'
#' CellRanger directories win; otherwise strip compression and role tokens.
#' Matching stems place `matrix.mtx`, `barcodes.tsv`, and `features.tsv` together.
#'
#' @param name A file name or path.
#'
#' @return The grouping key.
#'
#' @export
#' @examples
#' GroupKey("GSM123_pbmc_matrix.mtx.gz")
#' GroupKey("GSM123/filtered_feature_bc_matrix/matrix.mtx.gz")
group_key <- function(name) {
  low <- .strip_compression(tolower(basename(name)))

  token_len <- rep(NA_integer_, length(low))
  for (token in .role_tokens) {
    hit <- is.na(token_len) & endsWith(low, token)
    token_len[hit] <- nchar(token)
  }
  out <- low
  stripped <- !is.na(token_len)
  out[stripped] <- sub(
    "[._-]+$", "",
    substr(low[stripped], 1, nchar(low[stripped]) - token_len[stripped])
  )

  nested <- which(grepl("/", name, fixed = TRUE))
  for (i in nested) {
    p <- strsplit(name[i], "/", fixed = TRUE)[[1]]
    dir_hit <- which(grepl(.tenx_dir_pattern, p[-length(p)], ignore.case = TRUE))
    if (length(dir_hit) > 0) {
      out[i] <- tolower(paste(p[seq_len(dir_hit[1])], collapse = "/"))
    }
  }
  out
}

#' CellRanger filtered output
#'
#' Filtered output ranks before raw.
#'
#' @param name A file name.
#'
#' @return `TRUE` when the name marks filtered output.
#'
#' @export
#' @examples
#' IsFiltered("GSM1_filtered_feature_bc_matrix.h5")
#' IsFiltered("GSM1_raw_feature_bc_matrix.h5")
is_filtered <- function(name) {
  low <- tolower(name)
  grepl("filtered", low, fixed = TRUE) & !grepl("unfiltered", low, fixed = TRUE)
}

#' @noRd
# Modality order and CellRanger feature mappings.
# filter_type selects rows; feature_types maps classes back to assays.
# hto selects Antibody Capture but is inferred only from Multiplexing Capture.
.modalities <- list(
  rna = list(
    assay = "RNA", filter_type = "Gene Expression",
    feature_types = "gene expression",
    tokens = c("_rna", "rna_", "gex", "geneexp")
  ),
  adt = list(
    assay = "ADT", filter_type = "Antibody Capture",
    feature_types = "antibody capture",
    tokens = c("_adt", "adt_", "antibody", "_prot", "citeseq")
  ),
  hto = list(
    assay = "HTO", filter_type = "Antibody Capture",
    feature_types = "multiplexing capture",
    tokens = c("_hto", "hto_", "hashing", "hashtag")
  ),
  atac = list(
    assay = "ATAC", filter_type = "Peaks",
    feature_types = "peaks",
    tokens = c("_atac", "atac_", "peak")
  )
)

.modality_tokens <- lapply(.modalities, `[[`, "tokens")

#' The CellRanger feature class to keep for an assay
#' @noRd
.assay_feature_type <- function(assay) .modalities[[assay]]$filter_type

#' The assay name an object should carry for a modality
#' @noRd
.assay_name <- function(modality) {
  .modalities[[modality]]$assay %||% toupper(modality)
}

#' The modality a CellRanger feature class reads back as, or NA
#' @noRd
.feature_type_modality <- function(types) {
  lookup <- stats::setNames(
    rep(names(.modalities), lengths(lapply(.modalities, `[[`, "feature_types"))),
    unlist(lapply(.modalities, `[[`, "feature_types"), use.names = FALSE)
  )
  unname(lookup[tolower(trimws(as.character(types)))])
}

#' Modalities in carrying order, anything unrecognised last
#' @noRd
.modal_order <- function(mods) {
  c(intersect(names(.modalities), mods), setdiff(mods, names(.modalities)))
}

#' Tokens hold no regex metacharacters, so alternation matches each in turn.
#' @noRd
.modality_patterns <- vapply(
  names(.modality_tokens),
  function(assay) paste(c(assay, .modality_tokens[[assay]]), collapse = "|"),
  character(1)
)

#' @noRd
.modality_in_vec <- function(text) {
  low <- tolower(text)
  out <- rep(NA_character_, length(low))
  todo <- rep(TRUE, length(low))
  for (assay in names(.modality_patterns)) {
    if (!any(todo)) {
      break
    }
    hit <- todo
    hit[todo] <- grepl(.modality_patterns[[assay]], low[todo], perl = TRUE)
    out[hit] <- assay
    todo[hit] <- FALSE
  }
  out
}

#' @noRd
.modality_rank <- function(text, assay) {
  found <- .modality_in_vec(text)
  if (is.null(assay) || is.na(assay)) {
    return(rep(1L, length(found)))
  }
  ifelse(is.na(found), 1L, ifelse(found == assay, 0L, 2L))
}
