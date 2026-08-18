#' Label clusters by their strongest marker set
#'
#' Scores each cell as the mean expression of a set's genes, averages that
#' within each cluster, and labels the cluster with its highest-scoring set.
#' Sets with no gene in `x` are dropped with a warning.
#'
#' Scores are unscaled across sets, so a housekeeping-heavy set can out-score a
#' sparse but specific one. Check `attr(out, "scores")` before trusting a label.
#' This function works best with specific markers (only expressed in one celltype
#' but absent from others).
#'
#' @param x A features by cells matrix, as `SeqoutMatrix(...)$X` and
#'   [bind_counts()] return.
#' @param clusters Cluster assignment per cell, one entry per column of `x`.
#' @param markers A named list of marker gene vectors, one per cell type.
#' @param normalize Scale each cell to 10,000 counts and `log1p()`. `"auto"`
#'   does it when `x` holds whole numbers.
#'
#' @return A character vector of labels, named by cluster, with the cluster by
#'   marker-set score matrix attached as attribute `scores`.
#'
#' @examples
#' \dontrun{
#' markers <- list(
#'   neuron = c("Neurod2", "Tbr1"),
#'   microglia = c("Cx3cr1", "C1qa")
#' )
#' expr <- Seurat::GetAssayData(obj, assay = "RNA", slot = "data") # Seurat v4
#' expr <- SeuratObject::LayerData(Seurat::JoinLayers(obj), layer = "data") # v5
#'
#' labels <- QuickAnnotation(expr, obj$seurat_clusters, markers)
#' obj$celltype <- labels[as.character(obj$seurat_clusters)]
#' }
#'
#' @export
quick_annotation <- function(x, clusters, markers, normalize = "auto") {
  if (length(clusters) != ncol(x)) {
    cli::cli_abort("{.arg clusters} has {length(clusters)} entr{?y/ies}, {.arg x} has {ncol(x)} cell{?s}.")
  }
  if (!is.list(markers) || is.null(names(markers))) {
    cli::cli_abort("{.arg markers} must be a named list of gene vectors.")
  }
  markers <- lapply(markers, intersect, rownames(x))
  empty <- lengths(markers) == 0
  if (any(empty)) {
    cli::cli_warn("No genes found for {.val {names(markers)[empty]}}; dropping.")
    markers <- markers[!empty]
  }
  if (length(markers) == 0) {
    cli::cli_abort("None of the marker genes are in {.arg x}.")
  }

  # Library size needs every gene, scoring only the marker rows.
  normalize <- isTRUE(normalize) || (identical(normalize, "auto") && .looks_like_counts(x))
  total <- if (normalize) .col_sums(x)
  x <- x[unique(unlist(markers, use.names = FALSE)), , drop = FALSE]
  if (normalize) x <- .lognorm(x, total)

  scores <- vapply(markers, function(genes) {
    .col_means(x[genes, , drop = FALSE])
  }, numeric(ncol(x)))

  clusters <- droplevels(as.factor(clusters))
  by_cluster <- rowsum(scores, clusters) / as.vector(table(clusters))

  labels <- colnames(by_cluster)[max.col(by_cluster, ties.method = "first")]
  names(labels) <- rownames(by_cluster)
  attr(labels, "scores") <- by_cluster
  labels
}

#' Counts per 10,000, logged, given per-cell totals over all genes
#' @noRd
.lognorm <- function(x, total) {
  total[total == 0] <- 1
  if (methods::is(x, "Matrix")) {
    log1p(x %*% Matrix::Diagonal(x = 1e4 / total))
  } else {
    log1p(t(t(x) * (1e4 / total)))
  }
}

#' @noRd
.col_sums <- function(x) if (methods::is(x, "Matrix")) Matrix::colSums(x) else colSums(x)

#' @noRd
.col_means <- function(x) if (methods::is(x, "Matrix")) Matrix::colMeans(x) else colMeans(x)

#' Whole numbers mean nothing has been normalised yet. Checks a sample.
#' @noRd
.looks_like_counts <- function(x) {
  values <- if (methods::is(x, "Matrix")) methods::slot(x, "x") else x
  if (length(values) > 1e4) values <- values[seq(1, length(values), length.out = 1e4)]
  all(values >= 0) && all(values == trunc(values))
}
