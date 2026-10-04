#' Convert matrix gene identifiers to annotation-specific names
#'
#' Uses `genevintage::geneid2name()` to detect species and rank compatible
#' annotation releases, or `genevintage::gene_names()` with a supplied mapping.
#' Detection is an estimate, especially for small or filtered gene sets. Pass
#' the known annotation explicitly when available. Unmapped IDs are retained.
#'
#' @param x A `seqout_matrix` from [seqout_matrix()], or a numeric matrix
#'   (including a sparse `Matrix`), with genes on rows.
#' @param ids Gene identifiers in row order. Defaults to the matrix row names;
#'   may instead come from a feature annotation column such as `x$var$gene_id`.
#' @param species,release,assembly,source Annotation choices passed to
#'   genevintage. `NULL` detects them from the identifiers. `source` can be
#'   `"ensembl"`, `"gencode"`, or `"gencode_all"`.
#' @param mapping Optional annotation table with `id` and `name` columns.
#'   Bypasses detection and downloads. Excel correction additionally requires
#'   `chr` and `biotype` columns, as in `genevintage::fetch_mapping()`.
#' @param quiet Suppress genevintage's progress messages and, with a supplied
#'   mapping, mapping warnings.
#'
#' @return The same kind of object with renamed rows. Counts, row order and
#'   observation metadata are preserved. For a `seqout_matrix`, `var` row names
#'   are updated together with `X`; original annotation columns are preserved.
#'   An audit is appended to `x$gene_annotation` (or the `gene_annotation`
#'   attribute of a plain matrix). Each entry records `operation`, `annotation`
#'   and a `features` table with the original row, input token, resolved name,
#'   unique output row name and status. Colliding row names get `.1`, `.2`, etc.;
#'   the unsuffixed gene name remains in the audit. Rows are never aggregated.
#'
#' @seealso [seqout_correct_names()], `genevintage::detect_release()`
#' @export
#' @examplesIf requireNamespace("genevintage", quietly = TRUE)
#' x <- matrix(1:4, nrow = 2, dimnames = list(
#'   c("ENSG00000141510.16", "ENSG00000012048.23"), c("s1", "s2")
#' ))
#' mapping <- data.frame(
#'   id = c("ENSG00000141510", "ENSG00000012048"),
#'   name = c("TP53", "BRCA1")
#' )
#' SeqoutGeneNames(x, mapping = mapping)
seqout_gene_names <- function(x, ids = NULL, species = NULL, release = NULL,
                              assembly = NULL, source = NULL, mapping = NULL,
                              quiet = FALSE) {
  .need("genevintage", "Gene-name conversion", repo = "universe")
  input <- .gene_input(x, ids)
  nm <- .gene_mapping_warnings(if (!is.null(mapping)) {
    genevintage::gene_names(input$ids, mapping, warn = !quiet)
  } else {
    genevintage::geneid2name(input$ids,
      species = species, release = release,
      assembly = assembly, source = source, quiet = quiet
    )
  })
  annotation <- .gene_annotation(nm, species, release, assembly, source, mapping)
  status <- ifelse(attr(nm, "mapped"), "mapped", "unmapped")
  .gene_output(x, input, nm, status, "gene_names", annotation)
}

#' Repair Excel-damaged gene names in a counts matrix
#'
#' Uses `genevintage::correct_genenames()` to resolve date-like gene names against
#' the chosen species and annotation. Tokens with multiple candidates or no
#' candidate are retained and reported. This cannot reconstruct every Excel
#' error or recover information lost through rounding.
#'
#' Supply `mapping`, or both `species` and `release`; genevintage refuses
#' damaged input otherwise, since symbols alone cannot establish species or
#' annotation vintage. Choosing a release explicitly also distinguishes
#' historical names such as `SEPT9` from `SEPTIN9`.
#' Only call this on gene labels: real dates and numeric identifiers can look
#' like Excel damage. Neither this function nor the matrix reader repairs
#' arbitrary spreadsheet cells.
#'
#' @inheritParams seqout_gene_names
#' @param ids Gene names to repair, in matrix row order. Defaults to row names.
#'   Pass `x$var$symbol` when damaged symbols live in a feature column.
#' @return See [seqout_gene_names()]. Status is `"corrected"`, `"ambiguous"`,
#'   `"unresolved"`, or `"unchanged"`. The audit preserves damaged input tokens.
#' @seealso [seqout_gene_names()]
#' @export
#' @examplesIf requireNamespace("genevintage", quietly = TRUE)
#' x <- matrix(1:4,
#'   nrow = 2,
#'   dimnames = list(c("9-Sep", "TP53"), c("s1", "s2"))
#' )
#' mapping <- data.frame(
#'   id = c("ENSG00000184640", "ENSG00000141510"),
#'   name = c("SEPTIN9", "TP53"), chr = "17", biotype = "protein_coding"
#' )
#' SeqoutCorrectNames(x, mapping = mapping)
seqout_correct_names <- function(x, ids = NULL, species = NULL, release = NULL,
                                 assembly = NULL, source = NULL, mapping = NULL,
                                 quiet = FALSE) {
  .need("genevintage", "Gene-name repair", repo = "universe")
  input <- .gene_input(x, ids)
  nm <- genevintage::correct_genenames(input$ids,
    species = species,
    release = release, assembly = assembly, source = source,
    mapping = mapping, quiet = quiet
  )
  status <- rep("unchanged", length(nm))
  status[input$ids %in% attr(nm, "unresolved")] <- "unresolved"
  status[input$ids %in% attr(nm, "ambiguous")] <- "ambiguous"
  status[attr(nm, "corrected")] <- "corrected"
  annotation <- .gene_annotation(nm, species, release, assembly, source, mapping)
  .gene_output(x, input, nm, status, "correct_names", annotation)
}

#' @noRd
.gene_input <- function(x, ids) {
  X <- if (inherits(x, "seqout_matrix")) x$X else x
  if (!(is.matrix(X) && is.numeric(X)) && !inherits(X, "Matrix")) {
    cli::cli_abort("{.arg x} must be a numeric matrix or a {.cls seqout_matrix}.")
  }
  if (inherits(x, "seqout_matrix") &&
    (!is.data.frame(x$var) || nrow(x$var) != nrow(X) ||
      !identical(rownames(x$var), rownames(X)))) {
    cli::cli_abort("{.code x$var} must have the same row names and order as {.code x$X}.")
  }
  rn <- rownames(X)
  ids <- ids %||% rn
  if (!is.character(ids) || length(ids) != nrow(X) || anyNA(ids) ||
    any(!nzchar(trimws(ids)))) {
    cli::cli_abort("{.arg ids} must contain one non-missing, non-empty character token per matrix row.")
  }
  if (!length(ids)) {
    cli::cli_abort("The matrix has no gene rows to annotate.")
  }
  list(ids = ids, original = rn %||% as.character(seq_len(nrow(X))))
}

#' Annotation metadata, preferring what genevintage resolved over what was asked for
#' @noRd
.gene_annotation <- function(nm, species, release, assembly, source, mapping) {
  list(
    species = attr(nm, "species") %||% species,
    release = attr(nm, "release") %||% release,
    assembly = attr(nm, "assembly") %||% assembly,
    source = attr(nm, "source") %||% source,
    supplied_mapping = !is.null(mapping)
  )
}

#' The audit a gene-name repair left on a matrix
#'
#' Reads the audit [seqout_gene_names()] or [seqout_correct_names()] appended,
#' wherever it lives: `x$gene_annotation` for a `seqout_matrix`, the
#' `gene_annotation` attribute for a plain matrix.
#'
#' @param x A result of [seqout_gene_names()] or [seqout_correct_names()].
#' @param which Which audit, when `x` was repaired more than once. `NULL`, the
#'   default, takes the most recent.
#'
#' @return The audit's `features` table: `original`, `input`, `name`,
#'   `row_name` and `status`, one row per matrix row. The call's `operation`
#'   and `annotation` are attached as attributes of the same names.
#'
#' @export
#' @examplesIf requireNamespace("genevintage", quietly = TRUE)
#' x <- matrix(1:4, nrow = 2, dimnames = list(
#'   c("ENSG00000141510.16", "ENSG00000012048.23"), c("s1", "s2")
#' ))
#' mapping <- data.frame(
#'   id = c("ENSG00000141510", "ENSG00000012048"),
#'   name = c("TP53", "BRCA1")
#' )
#' x |>
#'   SeqoutGeneNames(mapping = mapping) |>
#'   SeqoutGeneReport()
seqout_gene_report <- function(x, which = NULL) {
  audits <- if (inherits(x, "seqout_matrix")) x$gene_annotation else attr(x, "gene_annotation")
  if (length(audits) == 0) {
    cli::cli_abort(c(
      "{.arg x} carries no gene-name audit.",
      i = "Run {.fn seqout_gene_names} or {.fn seqout_correct_names} on it first."
    ))
  }
  audit <- audits[[which %||% length(audits)]]
  report <- audit$features
  attr(report, "operation") <- audit$operation
  attr(report, "annotation") <- audit$annotation
  report
}

#' @noRd
.gene_output <- function(x, input, nm, status, operation, annotation) {
  resolved <- as.vector(nm)
  rows <- make.unique(resolved)
  audit <- list(
    operation = operation, annotation = annotation,
    features = data.frame(
      original = input$original, input = input$ids,
      name = resolved, row_name = rows, status = status,
      stringsAsFactors = FALSE
    )
  )
  if (inherits(x, "seqout_matrix")) {
    rownames(x$X) <- rows
    rownames(x$var) <- rows
    x$gene_annotation <- c(x$gene_annotation, list(audit))
  } else {
    rownames(x) <- rows
    attr(x, "gene_annotation") <- c(attr(x, "gene_annotation"), list(audit))
  }
  x
}

#' @noRd
.gene_mapping_warnings <- function(code) {
  # .gene_output disambiguates names via make.unique() anyway
  withCallingHandlers(code, genevintage_duplicate_names = function(w) {
    invokeRestart("muffleWarning")
  })
}
