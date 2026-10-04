#' Infer sample sex directly from a Seqout counts matrix
#'
#' Species is inferred from Ensembl-like row identifiers with genevintage, then
#' sex-chromosome markers are obtained from the same annotation registry used by
#' SexSeek. The returned table contains the dual-evidence coordinates
#' (`y_percent` and `x_percent`) used by [seqout_sex_plot()].
#'
#' @param x A `seqout_matrix`, numeric matrix, `seqout_counts` table, or one
#'   GSE/GSM accession.
#' @param sample Unit/sample to read when `x` is an accession or counts table.
#' @param species Optional species override. Usually unnecessary for Ensembl IDs.
#' @param model Model passed to `SexSeek::EstimateSex()`.
#' @param symbol_index Optional genevintage symbol index for standalone symbol matrices.
#' @param ... Other arguments passed to `SexSeek::EstimateSex()`.
#' @return A data frame of per-unit calls with inferred species and evidence
#'   coordinates.
#' @export
seqout_sex <- function(x, sample = NULL, species = NULL,
                       model = "ratio", symbol_index = NULL, ...) {
  .need("SexSeek", "Sex inference", repo = "universe")
  accession_hint <- NULL
  if (is.character(x) && length(x) == 1L) {
    accession_hint <- x
    counts <- seqout_counts(x)
    if (is.null(sample) && startsWith(toupper(x), "GSE")) {
      ms <- matrices(counts)
      ms <- ms[vapply(ms, function(m) inherits(m, "seqout_matrix"), logical(1))]
      if (!length(ms)) cli::cli_abort("No readable count matrices were found for {.val {x}}.")
      genes <- Reduce(intersect, lapply(ms, function(m) rownames(m$X)))
      x <- do.call(cbind, lapply(ms, function(m) m$X[genes, 1, drop = FALSE]))
      colnames(x) <- names(ms)
    } else {
      x <- seqout_matrix(counts, sample = sample)
    }
  } else if (inherits(x, "seqout_counts")) {
    accession_hint <- .handle(x)$accession
    x <- seqout_matrix(x, sample = sample)
  }
  if (inherits(x, "seqout_matrix")) x <- x$X
  if (!is.matrix(x) || !is.numeric(x)) {
    cli::cli_abort("{.arg x} must be a numeric matrix, {.cls seqout_matrix}, or accession.")
  }
  ids <- rownames(x)
  if (is.null(ids) || !length(ids)) cli::cli_abort("Counts matrix must have gene row names.")

  if (is.null(species)) {
    .need("genevintage", "Species detection", repo = "universe")
    hit <- genevintage::detect_species(ids)
    if (nrow(hit) && max(hit$frac, na.rm = TRUE) >= 0.5) {
      species <- gsub("_", " ", hit$species[[which.max(hit$frac)]])
    } else if (!is.null(symbol_index)) {
      sh <- genevintage::detect_species_names(ids, symbol_index)
      if (nrow(sh) && identical(sh$status[[1]], "selected")) species <- gsub("_", " ", sh$species[[1]])
    } else if (!is.null(accession_hint)) {
      meta <- tryCatch(seqout_get(accession_hint)$meta, error = function(e) NULL)
      org <- if (!is.null(meta) && "organisms" %in% names(meta)) meta$organisms[[1]] else NA_character_
      if (length(org) && !is.na(org) && nzchar(org)) species <- strsplit(org, "[;,]")[[1]][1]
    }
    if (is.null(species) || is.na(species) || !nzchar(species)) {
      cli::cli_abort("Species could not be inferred from these gene identifiers or accession metadata; pass {.arg species}.")
    }
  }
  annotation <- tryCatch(SexSeek::SexChromosomeGenes(species), error = function(e) NULL)
  out <- SexSeek::EstimateSex(x,
    species = species, annotation = annotation,
    model = model, ...
  )
  out$inferred_species <- species
  out$y_percent <- 100 * out$y_score / pmax(out$qc_score, 1)
  out$x_percent <- 100 * out$inact_score / pmax(out$qc_score, 1)
  class(out) <- c("seqout_sex", class(out))
  out
}

#' Plot dual sex-chromosome evidence
#'
#' @param x A result from [seqout_sex()].
#' @return A ggplot object.
#' @export
seqout_sex_plot <- function(x) {
  if (!inherits(x, "seqout_sex")) cli::cli_abort("Pass the result of {.fn seqout_sex}.")
  if (!requireNamespace("ggplot2", quietly = TRUE)) cli::cli_abort("Install {.pkg ggplot2} to plot evidence.")
  ggplot2::ggplot(x, ggplot2::aes(x = y_percent, y = x_percent, colour = verdict)) +
    ggplot2::geom_point(size = 2, alpha = 0.85) +
    ggplot2::labs(
      x = "% Y (or W) marker expression", y = "% X-inactivation marker expression",
      colour = "Inferred sex"
    ) +
    ggplot2::theme_minimal()
}

# ggplot2 aes() columns
utils::globalVariables(c("verdict", "x_percent", "y_percent"))
