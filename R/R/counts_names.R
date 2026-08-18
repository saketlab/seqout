#' File-role classification for GEO supplementary files
#'
#' Mirrors the Python client so both name the same role for the same file.
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

#' @noRd
.sidecar_names <- c(
  "fragments.tsv", "readme", "md5sum",
  "tissue_positions", "scalefactors", "web_summary", "metrics_summary"
)

#' @noRd
.barcode_names <- c("barcodes.tsv", "barcodes.csv", "_barcodes.")

#' @noRd
.feature_names <- c("features.tsv", "genes.tsv", "features.csv", "genes.csv")

#' @noRd
.role_tokens <- c(
  "matrix.mtx", "barcodes.tsv", "features.tsv", "genes.tsv",
  "barcodes.csv", "features.csv", "genes.csv", "matrix.csv"
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

#' endsWith returns NA for an NA name, where grepl returns FALSE
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
#' Names the role of a file from its name alone, which is what lets the counts
#' table be built before anything is downloaded.
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

  hit <- todo & .has_any(low, .sidecar_names)
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
#' A canonical CellRanger directory wins over the filename; otherwise the
#' filename with its compression suffix and terminal role token stripped, so
#' `GSM123_x_matrix.mtx.gz` and `GSM123_x_barcodes.tsv.gz` land together.
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
#' Filtered output is preferred over raw when a sample ships both.
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
.modality_tokens <- list(
  rna = c("_rna", "rna_", "gex", "geneexp"),
  adt = c("_adt", "adt_", "antibody", "_prot", "citeseq"),
  hto = c("_hto", "hto_", "hashing", "hashtag"),
  atac = c("_atac", "atac_", "peak")
)

#' One alternation per assay; the tokens hold no regex metacharacters, so this
#' is the same test as matching each in turn.
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
