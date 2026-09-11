#' Format readers for counts matrices
#'
#' Readers return observations by features. `.read_unit()` transposes to
#' features by observations.
#' @noRd
NULL

#' @noRd
.need <- function(pkg, what = "Reading this format", bioc = FALSE) {
  if (requireNamespace(pkg, quietly = TRUE)) {
    return(invisible(TRUE))
  }
  install <- if (bioc) {
    'BiocManager::install("{pkg}")'
  } else {
    'install.packages("{pkg}")'
  }
  cli::cli_abort(c(
    "{what} needs the {.pkg {pkg}} package.",
    i = paste0("Install it with {.code ", install, "}.")
  ))
}

#' @noRd
.open_maybe_gz <- function(path, mode = "rt") {
  con <- if (grepl("\\.gz$", path)) gzfile(path, mode) else file(path, mode)
  con
}

#' @noRd
.read_split_lines <- function(path) {
  con <- .open_maybe_gz(path)
  on.exit(close(con), add = TRUE)
  lines <- readLines(con, warn = FALSE)
  lines <- lines[nzchar(lines)]
  if (length(lines) == 0) {
    return(list())
  }
  sep <- if (grepl("\t", lines[1], fixed = TRUE)) "\t" else ","
  strsplit(lines, sep, fixed = TRUE)
}

#' @noRd
.column_of <- function(split, column = 1L) {
  if (length(split) == 0) {
    return(character(0))
  }
  widths <- lengths(split)
  if (all(widths >= column)) {
    starts <- cumsum(c(0L, widths[-length(widths)]))
    return(unlist(split, use.names = FALSE)[starts + column])
  }
  vapply(split, function(p) if (length(p) >= column) p[column] else p[1], character(1))
}

#' @noRd
.read_lines_col <- function(path, column = 1L) {
  .column_of(.read_split_lines(path), column)
}

#' @noRd
.drop_label_headers <- function(x) {
  x[!tolower(x) %in% c("x", "barcode", "barcodes", "cell", "cells", "gene", "genes", "feature", "features")]
}

#' Read a 10x MatrixMarket triplet
#' @noRd
.read_10x_mtx <- function(mtx_path, barcodes_path, features_path, feature_type = NULL) {
  .need("Matrix")
  con <- .open_maybe_gz(mtx_path)
  on.exit(close(con), add = TRUE)
  m <- methods::as(Matrix::readMM(con), "CsparseMatrix")

  barcodes <- .drop_label_headers(.read_lines_col(barcodes_path, 1L))
  feature_rows <- .read_split_lines(features_path)
  features <- .drop_label_headers(.column_of(feature_rows, 1L))
  types <- .optional_column(feature_rows, 3L)
  keep <- .keep_feature_type(features, types, feature_type)

  if (nrow(m) == length(features) && ncol(m) == length(barcodes)) {
    m <- m[keep, , drop = FALSE]
    features <- features[keep]
    m <- Matrix::t(m)
  } else if (nrow(m) == length(barcodes) && ncol(m) == length(features)) {
    m <- m[, keep, drop = FALSE]
    features <- features[keep]
  } else {
    cli::cli_abort(
      "Matrix is {nrow(m)}x{ncol(m)} but there are {length(barcodes)} barcodes and {length(features)} features."
    )
  }

  var <- data.frame(row.names = make.unique(features))
  # a multiome ships genes and peaks in one matrix; the type tells them apart
  var <- .add_feature_column(var, .optional_column(feature_rows, 2L)[keep], "symbol")
  var <- .add_feature_column(var, types[keep], "feature_type")

  list(
    X = methods::as(m, "CsparseMatrix"),
    obs = data.frame(row.names = make.unique(barcodes)),
    var = var
  )
}

#' Attach a feature column when the file carried one
#'
#' `values` must be subset to the retained features.
#' @noRd
.add_feature_column <- function(var, values, name) {
  if (length(values) != nrow(var) || all(is.na(values))) {
    return(var)
  }
  var[[name]] <- values
  var
}

#' @noRd
.keep_feature_type <- function(features, types, feature_type) {
  if (is.null(feature_type) || length(types) != length(features)) {
    return(rep(TRUE, length(features)))
  }
  keep <- types == feature_type
  if (!any(keep)) rep(TRUE, length(features)) else keep
}

#' Read a CellRanger HDF5 matrix
#' @noRd
.read_10x_h5 <- function(path, feature_type = NULL) {
  .need("hdf5r")
  .need("Matrix")
  h5 <- hdf5r::H5File$new(path, mode = "r")
  on.exit(h5$close_all(), add = TRUE)

  grp <- if ("matrix" %in% names(h5)) {
    h5[["matrix"]]
  } else {
    genomes <- Filter(function(n) inherits(h5[[n]], "H5Group"), names(h5))
    if (length(genomes) == 0) {
      cli::cli_abort("{basename(path)}: no matrix group found.")
    }
    h5[[genomes[1]]]
  }

  shape <- if ("shape" %in% names(grp)) grp[["shape"]]$read() else NULL
  barcodes <- as.character(grp[["barcodes"]]$read())
  features <- if ("features" %in% names(grp)) {
    as.character(grp[["features"]][["name"]]$read())
  } else {
    as.character(grp[["gene_names"]]$read())
  }
  types <- if ("features" %in% names(grp) && "feature_type" %in% names(grp[["features"]])) {
    as.character(grp[["features"]][["feature_type"]]$read())
  } else {
    character(0)
  }

  n_genes <- if (!is.null(shape)) shape[1] else length(features)
  n_cells <- if (!is.null(shape)) shape[2] else length(barcodes)
  keep <- .keep_feature_type(features, types, feature_type)
  # cut before the branch below reassigns features
  kept_types <- if (length(types) == length(keep)) types[keep] else character(0)

  data <- grp[["data"]]$read()
  indices <- grp[["indices"]]$read()
  indptr <- grp[["indptr"]]$read()

  if (!all(keep)) {
    feature_index <- which(keep)
    remap <- integer(length(features))
    remap[feature_index] <- seq_along(feature_index)
    data_index <- indices + 1L
    hit <- keep[data_index]
    cell_index <- rep.int(seq_len(n_cells), diff(indptr))
    m <- Matrix::sparseMatrix(
      i = cell_index[hit], j = remap[data_index[hit]], x = as.numeric(data[hit]),
      dims = c(n_cells, length(feature_index)), index1 = TRUE
    )
    features <- features[keep]
  } else {
    m <- Matrix::sparseMatrix(
      i = indices + 1L, p = indptr, x = as.numeric(data),
      dims = c(n_genes, n_cells), index1 = TRUE, repr = "C"
    )
    m <- Matrix::t(m)
  }

  var <- data.frame(row.names = make.unique(features))
  list(
    X = m,
    obs = data.frame(row.names = make.unique(barcodes)),
    var = .add_feature_column(var, kept_types, "feature_type")
  )
}

#' Read an .h5ad written by anndata
#' @noRd
.read_h5ad <- function(path) {
  .need("hdf5r")
  .need("Matrix")
  h5 <- hdf5r::H5File$new(path, mode = "r")
  on.exit(h5$close_all(), add = TRUE)

  obs <- .read_h5ad_frame(h5[["obs"]])
  var <- .read_h5ad_frame(h5[["var"]])
  X <- .read_h5ad_x(h5[["X"]], nrow(obs), nrow(var))

  list(X = X, obs = obs, var = var)
}

#' @noRd
.read_h5ad_x <- function(node, n_obs, n_var) {
  if (inherits(node, "H5Group")) {
    enc <- .h5_attr(node, "encoding-type")
    data <- node[["data"]]$read()
    indices <- node[["indices"]]$read()
    indptr <- node[["indptr"]]$read()
    if (identical(enc, "csc_matrix")) {
      return(Matrix::sparseMatrix(
        i = indices + 1L, p = indptr, x = as.numeric(data),
        dims = c(n_obs, n_var), index1 = TRUE, repr = "C"
      ))
    }
    obs_index <- rep.int(seq_len(n_obs), diff(indptr))
    return(Matrix::sparseMatrix(
      i = obs_index, j = indices + 1L, x = as.numeric(data),
      dims = c(n_obs, n_var), index1 = TRUE
    ))
  }
  dense <- node$read()
  if (nrow(dense) == n_var && ncol(dense) == n_obs) dense <- t(dense)
  dense
}

#' @noRd
.h5_attr <- function(node, name) {
  if (!(name %in% hdf5r::h5attr_names(node))) {
    return(NA_character_)
  }
  as.character(hdf5r::h5attr(node, name))[1]
}

#' @noRd
.read_h5ad_frame <- function(grp) {
  index_key <- .h5_attr(grp, "_index")
  if (is.na(index_key)) index_key <- "_index"
  idx <- if (index_key %in% names(grp)) as.character(grp[[index_key]]$read()) else character(0)

  cols <- setdiff(names(grp), c(index_key, "__categories"))
  out <- list()
  for (nm in cols) {
    val <- tryCatch(.read_h5ad_column(grp, nm), error = function(e) NULL)
    if (!is.null(val) && length(val) == length(idx)) out[[nm]] <- val
  }
  if (length(out) == 0) {
    return(data.frame(row.names = make.unique(idx)))
  }
  df <- as.data.frame(out, stringsAsFactors = FALSE, optional = TRUE)
  rownames(df) <- make.unique(idx)
  df
}

#' @noRd
.read_h5ad_column <- function(grp, nm) {
  node <- grp[[nm]]
  if (inherits(node, "H5Group")) {
    if (all(c("codes", "categories") %in% names(node))) {
      codes <- node[["codes"]]$read()
      cats <- as.character(node[["categories"]]$read())
      return(cats[codes + 1L])
    }
    return(NULL)
  }
  v <- node$read()
  if (is.array(v) && length(dim(v)) > 1) {
    return(NULL)
  }
  v
}

#' Read counts out of an .rds
#'
#' Handles matrices, data frames, Seurat objects, and SingleCellExperiment objects.
#' @noRd
.read_rds <- function(path, assay = "rna") {
  .counts_from_object(.read_rds_object(path), assay)
}

#' Read an .rds through however many gzip layers it carries
#'
#' `saveRDS()` gzips by default. `gzcon()` over `gzfile()` handles an added
#' gzip layer and also reads plain `.rds` files.
#' @noRd
.read_rds_object <- function(path) {
  con <- gzcon(gzfile(path, "rb"))
  on.exit(close(con), add = TRUE)
  readRDS(con)
}

#' @noRd
.counts_from_object <- function(obj, assay = "rna") {
  if (inherits(obj, c("dgCMatrix", "dgTMatrix", "matrix", "Matrix"))) {
    return(.orient_counts(obj, NULL))
  }
  if (is.data.frame(obj)) {
    m <- as.matrix(obj[, vapply(obj, is.numeric, logical(1)), drop = FALSE])
    return(.orient_counts(m, NULL))
  }
  if (isS4(obj)) {
    slots <- methods::slotNames(obj)
    if ("assays" %in% slots) {
      assays <- methods::slot(obj, "assays")
      pick <- .pick_assay(names(assays), assay)
      inner <- assays[[pick]]
      counts <- .s4_first(inner, c("counts", "data", "layers"))
      meta <- .s4_meta(obj)
      return(.orient_counts(counts, meta))
    }
    if ("assays" %in% slots || "int_colData" %in% slots) {
      counts <- .s4_first(obj, c("counts", "logcounts"))
      return(.orient_counts(counts, .s4_meta(obj)))
    }
  }
  cli::cli_abort("Could not find a counts matrix in this object ({class(obj)[1]}).")
}

#' @noRd
.pick_assay <- function(available, assay) {
  if (length(available) == 0) {
    cli::cli_abort("The object carries no assays.")
  }
  if (is.null(assay) || is.na(assay)) {
    return(available[1])
  }
  hit <- available[.modality_matches(available, assay)]
  if (length(hit) > 0) hit[1] else available[1]
}

#' @noRd
.modality_matches <- function(names_vec, assay) {
  found <- .modality_in_vec(names_vec)
  !is.na(found) & found == assay
}

#' @noRd
.s4_first <- function(obj, candidates) {
  for (nm in candidates) {
    val <- tryCatch(methods::slot(obj, nm), error = function(e) NULL)
    if (!is.null(val) && (inherits(val, "Matrix") || is.matrix(val))) {
      return(val)
    }
    if (is.list(val) && length(val) > 0) {
      return(val[[1]])
    }
  }
  cli::cli_abort("No counts slot found on a {class(obj)[1]} object.")
}

#' @noRd
.s4_meta <- function(obj) {
  for (nm in c("meta.data", "colData")) {
    val <- tryCatch(methods::slot(obj, nm), error = function(e) NULL)
    if (is.data.frame(val)) {
      return(val)
    }
    if (!is.null(val) && inherits(val, "DFrame")) {
      return(as.data.frame(val))
    }
  }
  NULL
}

#' @noRd
.orient_counts <- function(m, meta) {
  m <- Matrix::t(methods::as(m, "CsparseMatrix"))
  obs <- if (!is.null(meta) && nrow(meta) == nrow(m)) {
    meta
  } else {
    data.frame(row.names = rownames(m))
  }
  list(X = m, obs = obs, var = data.frame(row.names = colnames(m)))
}

#' Best delimiter for a block of lines, or NULL if none splits them cleanly
#'
#' Uniform widest split wins; quotes protect commas inside sample names.
#' `sep = ""` is scan()'s whitespace mode.
#' @noRd
.best_sep <- function(lines) {
  candidates <- c("\t", ";", ",", "")
  score <- vapply(candidates, function(sep) {
    n <- utils::count.fields(textConnection(lines),
      sep = sep, quote = "\"",
      comment.char = ""
    )
    # NA means an unterminated quote, so the candidate failed
    if (!anyNA(n) && length(unique(n)) == 1L && n[1] >= 2L) n[1] else 0L
  }, integer(1), USE.NAMES = FALSE)
  if (any(score > 0L)) candidates[which.max(score)] else NULL
}

#' Detect a table's delimiter
#'
#' Data rows decide; the header is fallback when rows are ragged.
#'
#' @param lines The first few lines of the file, header included.
#'
#' @return One of `"\t"`, `";"`, `","` or `""` (whitespace).
#' @noRd
.sniff_sep <- function(lines) {
  .best_sep(lines[-1]) %||% .best_sep(lines[1]) %||% ","
}

# featureCounts and htseq tables put gene annotation in numeric columns beside
# the sample columns; transposed blindly they would each become an observation
.var_cols <- c(
  "length", "genelength", "gene_length", "exonlength", "effective_length",
  "efflength", "merged_length", "start", "end", "start_position",
  "end_position", "width", "gc", "gc_content"
)

# htseq-count appends its summary rows to the counts; STAR does the same in
# ReadsPerGene.out.tab. Drop summary rows to preserve library-size estimates.
.qc_rows <- c(
  "no_feature", "ambiguous", "too_low_aqual", "not_aligned",
  "alignment_not_unique", "n_unmapped", "n_multimapping", "n_nofeature",
  "n_ambiguous"
)

#' @noRd
.is_qc_row <- function(x) {
  startsWith(x, "__") | tolower(gsub("^_+|_+$", "", x)) %in% .qc_rows
}

#' Whether the first line contains counts
#'
#' Treating an htseq-count gene/count row as a header loses the first gene
#' and labels the sample with a count.
#' @noRd
.headerless <- function(line, sep) {
  fields <- if (identical(sep, "")) {
    strsplit(trimws(line), "[[:space:]]+")[[1]]
  } else {
    strsplit(line, sep, fixed = TRUE)[[1]]
  }
  length(fields) >= 2L && !anyNA(suppressWarnings(as.numeric(fields[-1])))
}

#' Name the unnamed count columns after the file they came from
#' @noRd
.headerless_names <- function(path, n) {
  stem <- sub("\\..*$", "", basename(path))
  if (n == 1L) stem else paste0(stem, "_", seq_len(n))
}

#' Read a delimited counts table
#'
#' Annotation columns, including featureCounts gene lengths and coordinates,
#' move to `var`. htseq and STAR summary rows are dropped.
#' @noRd
.read_table <- function(path) {
  con <- .open_maybe_gz(path)
  head_lines <- readLines(con, n = 4L, warn = FALSE)
  close(con)
  sep <- .sniff_sep(head_lines)
  headerless <- .headerless(head_lines[1], sep)

  con <- .open_maybe_gz(path)
  on.exit(close(con), add = TRUE)
  df <- utils::read.delim(
    con,
    sep = sep, row.names = 1, check.names = FALSE, header = !headerless
  )
  if (headerless) {
    names(df) <- .headerless_names(path, ncol(df))
  }

  qc <- .is_qc_row(rownames(df))
  if (any(qc)) {
    cli::cli_inform(
      "{.path {basename(path)}}: dropped {sum(qc)} summary row{?s}: {.val {rownames(df)[qc]}}."
    )
    df <- df[!qc, , drop = FALSE]
  }

  is_ann <- !vapply(df, is.numeric, logical(1)) |
    tolower(trimws(names(df))) %in% .var_cols
  var <- df[, is_ann, drop = FALSE]
  df <- df[, !is_ann, drop = FALSE]
  m <- t(as.matrix(df))

  # empty parsed matrix means parse failure, or a table that is all annotation
  if (nrow(m) == 0L || ncol(m) == 0L) {
    cli::cli_abort(c(
      "{.path {basename(path)}}: read as an empty matrix.",
      i = "Split on {.val {sep}} into {ncol(df)} count column{?s}, {sum(is_ann)} annotation column{?s} and {nrow(df)} row{?s}."
    ))
  }

  list(
    X = m,
    obs = data.frame(row.names = rownames(m)),
    var = var
  )
}

#' A column only when every row has it
#'
#' .column_of() falls back to the first column, which would pass feature ids off
#' as feature classes on a two-column features.tsv.
#' @noRd
.optional_column <- function(split, column) {
  if (length(split) == 0 || !all(lengths(split) >= column)) {
    return(character(0))
  }
  .column_of(split, column)
}
