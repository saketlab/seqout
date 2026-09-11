#' List count-matrix units for a GEO accession
#'
#' Groups supplementary files into readable units without downloading them.
#'
#' A unit is a 10x triplet, CellRanger `.h5`, `.h5ad`, `.rds`, tar, or table.
#'
#' `has_metadata` means embedded metadata or a named sidecar was found.
#'
#' `preferred` ranks requested assay, filtered output, then format.
#'
#' 10x feature class follows `assay`; `feature_type` overrides it.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A GSE or GSM accession.
#' @param assay Assay preference: `"rna"` (default), `"adt"`, `"hto"`,
#'   `"atac"`, or `NULL`.
#' @param feature_type 10x feature class to keep, overriding the one implied by
#'   `assay`. `NULL` keeps every row.
#' @param cache_dir Where downloads land. Defaults to a per-accession directory
#'   under [tools::R_user_dir()], reused across sessions.
#'
#' `assay` names the modality read from the file names, `NA` when none is
#' named. A sample carrying several becomes a multimodal object.
#'
#' @return A tibble, one row per readable unit.
#'
#' @export
#' @examples
#' \dontrun{
#' counts <- SeqoutListCounts("GSE297547")
#' counts[, c("unit", "sample", "format", "preferred")]
#' m <- SeqoutMatrix(counts, sample = "GSM8994520")
#'
#' "GSE297547" |>
#'   SeqoutListCounts() |>
#'   SeqoutMatrix(sample = "GSM8994520")
#' }
seqout_counts <- function(accession, assay = "rna", feature_type = NULL,
                          cache_dir = NULL, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  accession <- toupper(trimws(accession))
  if (!grepl("^(GSE|GSM)", accession)) {
    cli::cli_abort("{.val {accession}}: only GSE and GSM accessions carry counts files.")
  }
  if (is.null(feature_type) && !is.null(assay)) {
    feature_type <- .assay_feature_type(assay)
  }
  if (is.null(cache_dir)) {
    cache_dir <- file.path(tools::R_user_dir("seqout", "cache"), "counts", accession)
  }

  handle <- structure(
    list(
      con = con, accession = accession, assay = assay,
      feature_type = feature_type, cache_dir = cache_dir,
      cache = new.env(parent = emptyenv())
    ),
    class = "seqout_counts"
  )
  units <- .counts_units(handle, preferred_only = FALSE)
  out <- .units_tibble(units)
  structure(out, class = c("seqout_counts", class(out)), .counts_handle = handle)
}


#' @export
`$.seqout_counts` <- function(x, name) {
  if (name %in% names(x)) {
    return(NextMethod("$"))
  }
  handle <- attr(x, ".counts_handle", exact = TRUE)
  if (!is.null(handle) && name %in% names(handle)) {
    return(handle[[name]])
  }
  cli::cli_abort(c(
    "{.val {name}} is not a column of the counts table.",
    i = "Columns: {.field {names(x)}}."
  ))
}

#' @noRd
.counts_files <- function(x) {
  if (exists("files", envir = x$cache, inherits = FALSE)) {
    return(base::get("files", envir = x$cache))
  }
  con <- x$con

  if (startsWith(x$accession, "GSM")) {
    urls <- .supplementary_urls(con, x$accession, sample = TRUE)
    if (length(urls) == 0) {
      urls <- .supplementary_of(con, "geo_samples", x$accession)[[1]]
    }
    rows <- .counts_file_rows(urls, x$accession)
    assign("n_samples", 1L, envir = x$cache)
  } else {
    samples <- project_samples(x$accession, con = con)
    assign("samples", samples, envir = x$cache)
    supp <- samples$supplementary_data
    by_sample <- if (is.character(supp)) {
      stats::setNames(.urls_in_json(supp), samples$accession)
    } else if (is.list(supp)) {
      stats::setNames(lapply(supp, .urls_in_records), samples$accession)
    } else {
      .supplementary_of(con, "geo_samples", samples$accession)
    }
    assign("n_samples", length(by_sample), envir = x$cache)
    sample_rows <- lapply(names(by_sample), function(acc) {
      .counts_file_rows(by_sample[[acc]], acc)
    })
    rows <- unlist(sample_rows, recursive = FALSE, use.names = FALSE)
    if (is.null(rows)) {
      rows <- list()
    }
    seen <- vapply(rows, function(r) r$url, character(1))
    series_urls <- .supplementary_urls(con, x$accession, sample = FALSE)
    if (length(series_urls) == 0) {
      series_urls <- .supplementary_of(con, "geo_series", x$accession)[[1]]
    }
    series_urls <- series_urls[!series_urls %in% seen]
    rows <- c(rows, .counts_file_rows(series_urls, NA_character_))
  }

  files <- .records_to_tibble(rows)
  assign("files", files, envir = x$cache)
  files
}

#' @noRd
.counts_file_rows <- function(urls, sample) {
  if (length(urls) == 0) {
    return(list())
  }
  roles <- file_role(urls)
  file_names <- basename(urls)
  samples <- rep(sample, length(urls))
  lapply(seq_along(urls), function(i) {
    list(
      url = urls[i], role = roles[i], sample = samples[i],
      platform = NA_character_, member = NA_character_, name = file_names[i]
    )
  })
}

#' Supplementary URLs from parsed JSON records
#'
#' URLs may be bare strings or stored under `#text` or `url`.
#' @noRd
.urls_in_records <- function(raw) {
  if (length(raw) == 0) {
    return(character(0))
  }
  urls <- vapply(raw, function(item) {
    if (is.character(item)) item[1] else (item[["#text"]] %||% item[["url"]] %||% NA_character_)
  }, character(1))
  unname(urls[!is.na(urls)])
}

#' Supplementary URLs from GEO JSON strings
#'
#' URLs may be bare strings or stored under `#text` or `url`.
#'
#' @return A list of character vectors, one per input string.
#' @noRd
.urls_in_json <- function(x) {
  x[is.na(x)] <- ""
  hits <- regmatches(x, gregexpr("\"(?:#text|url)\":\\s*\"[^\"]*\"", x))
  lapply(hits, function(h) {
    if (length(h) == 0) {
      return(character(0))
    }
    sub("\"$", "", sub("^.*:\\s*\"", "", h))
  })
}

#' Supplementary file URLs for many accessions in one query
#'
#' DuckDB can unnest series JSON in one query; API fallback reads per accession.
#'
#' @return A list of character vectors, one per accession, in the order given.
#' @noRd
.supplementary_of <- function(con, table, accessions) {
  accessions <- unique(accessions[!is.na(accessions)])
  if (length(accessions) == 0) {
    return(list(character(0)))
  }
  levels <- factor(accessions, levels = accessions)
  sql <- sprintf("
    SELECT t.accession AS accession,
      coalesce(
        json_extract_string(j, '$.\"#text\"'),
        json_extract_string(j, '$.url'),
        json_extract_string(j, '$')
      ) AS url
    FROM %s t,
         LATERAL (SELECT unnest(from_json(t.supplementary_data, '[\"json\"]')) AS j)
    WHERE t.accession IN (%s)
  ", table, paste(rep("?", length(accessions)), collapse = ", "))

  df <- if (identical(con$backend, "parquet")) {
    tryCatch(.db_query(con, sql, params = as.list(accessions)), error = function(e) NULL)
  }
  if (is.null(df)) {
    urls <- lapply(accessions, function(a) {
      .supplementary_urls(con, a, sample = !identical(table, "geo_series"))
    })
    names(urls) <- accessions
    return(urls)
  }
  df <- df[!is.na(df$url), , drop = FALSE]
  split(df$url, factor(df$accession, levels = levels(levels)))
}

#' @noRd
.supplementary_urls <- function(con, accession, sample = TRUE) {
  path <- if (sample) paste0("/sample-detail/", accession) else paste0("/project/", accession)
  res <- tryCatch(.api_get(con, path), error = function(e) NULL)
  if (is.null(res)) {
    return(character(0))
  }
  .urls_in_records(res$supplementary_data %||% res$sample$supplementary_data %||% list())
}

#' @noRd
.counts_units <- function(x, preferred_only = TRUE) {
  if (!exists("units", envir = x$cache, inherits = FALSE)) {
    files <- .counts_files(x)
    keep <- files$role != "skip"
    assign("units", .group_units(files[keep, , drop = FALSE], x$accession, x$assay),
      envir = x$cache
    )
  }
  units <- base::get("units", envir = x$cache)
  if (preferred_only) Filter(function(u) isTRUE(u$preferred), units) else units
}

#' @noRd
.units_tibble <- function(units) {
  tibble::tibble(
    unit = vapply(units, function(u) u$label, character(1)),
    sample = vapply(units, function(u) u$sample %||% NA_character_, character(1)),
    format = vapply(units, function(u) u$fmt, character(1)),
    assay = vapply(units, .unit_modality, character(1)),
    preferred = vapply(units, function(u) isTRUE(u$preferred), logical(1)),
    has_metadata = vapply(units, .unit_has_metadata, logical(1)),
    n_files = vapply(units, function(u) length(u$files), integer(1)),
    files = vapply(units, function(u) {
      paste(vapply(u$files, function(f) f$name, character(1)), collapse = ", ")
    }, character(1))
  )
}

#' Choose which samples of a study to read
#'
#' Keeps samples matching [sample_search()] with a readable unit.
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()], built on a
#'   GSE.
#' @param ... Filters for [sample_search()], by name, such as
#'   `tissue = "liver"`. `study_accession` comes from `counts`.
#' @param min_cell_count Smallest cell count to keep. Samples with no recorded
#'   count go too; `NULL` keeps everything.
#'
#' @return Matching samples, sorted by cells, with `unit` and `format`.
#'
#' @seealso [seqout_counts()] for every unit, unfiltered.
#'
#' @export
#' @examples
#' \dontrun{
#' counts <- seqout_counts("GSE182159")
#' liver <- counts_samples(counts, tissue = "liver", min_cell_count = 1000)
#' m <- seqout_matrix(counts, sample = liver$unit[1])
#' }
counts_samples <- function(counts, ..., min_cell_count = 1L) {
  .check_counts(counts)
  if (!startsWith(counts$accession, "GSE")) {
    cli::cli_abort(c(
      "{counts$accession} is a single sample.",
      i = "Give {.fn seqout_counts} a GSE to select within it."
    ))
  }
  rows <- sample_search(
    study_accession = counts$accession, ...,
    min_cell_count = min_cell_count, con = counts$con
  )
  if (nrow(rows) == 0 && !is.null(min_cell_count)) {
    # bulk samples record no cell count, so the single-cell default drops them
    rows <- sample_search(
      study_accession = counts$accession, ...,
      min_cell_count = NULL, con = counts$con
    )
    if (nrow(rows) > 0) {
      cli::cli_inform(
        "No sample in {counts$accession} records a cell count; ignoring {.arg min_cell_count}."
      )
    }
  }
  out <- .with_units(rows, counts[counts$preferred, , drop = FALSE])
  if (nrow(out) == 0 && nrow(rows) > 0) {
    cli::cli_warn(c(
      "{nrow(rows)} sample{?s} matched the filters, but none ships a counts file.",
      i = "Inspect the table from {.fn seqout_counts} to see what {counts$accession} ships."
    ))
  }
  out
}

#' Join the annotated samples to the unit each one would be read from
#' @noRd
.with_units <- function(rows, m) {
  i <- match(rows$sample, m$sample)
  out <- rows[!is.na(i), , drop = FALSE]
  i <- i[!is.na(i)]
  out$unit <- m$unit[i]
  out$format <- m$format[i]

  cells <- out[["cells"]]
  if (is.null(cells) || all(is.na(cells))) cells <- out[["cell_count"]]
  if (!is.null(cells)) {
    out <- out[order(cells, decreasing = TRUE, na.last = TRUE), , drop = FALSE]
  }
  front <- intersect(c("sample", "unit", "format", "cells", "tissue"), names(out))
  out[c(front, setdiff(names(out), front))]
}

#' The study's sample table, one row per sample
#'
#' The submitter's characteristics spread into one column each. Reuses the
#' sample record [seqout_counts()] fetched.
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()].
#'
#' @return A tibble, one row per sample of the study.
#'
#' @seealso [counts_samples()] for the harmonised cohort fields.
#'
#' @export
#' @examples
#' \dontrun{
#' counts <- SeqoutListCounts("GSE135251")
#' col_data <- CountsDesign(counts)
#' }
counts_design <- function(counts) {
  .check_counts(counts)
  .sample_rows(counts)
}

#' The readable units behind a counts table
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()].
#' @param preferred_only Return only the preferred unit per sample.
#'
#' @return A list of units.
#'
#' @export
seqout_units <- function(counts, preferred_only = TRUE) {
  .check_counts(counts)
  .counts_units(counts, preferred_only = preferred_only)
}

#' Download a unit's files without parsing them
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()].
#' @param sample A unit label or sample accession.
#'
#' @return The paths of the downloaded files.
#'
#' @export
seqout_counts_files <- function(counts, sample = NULL) {
  .check_counts(counts)
  unit <- .select_unit(counts, sample)
  .fetch_unit(counts, unit)
}

#' Read one unit as a counts matrix
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()].
#' @param sample A unit label or sample accession. Required when the accession
#'   holds more than one unit.
#'
#' @return A `seqout_matrix`: a list with `X` (features by observations),
#'   `obs`, `var`, `kind`, `fmt` and `evidence`.
#'
#' @export
seqout_matrix <- function(counts, sample = NULL) {
  .check_counts(counts)
  unit <- .select_unit(counts, sample)
  .read_unit(counts, unit)
}

#' Convert counts to a Seurat object
#'
#' `X` becomes counts and `obs` becomes `meta.data`.
#' A GSE or GSM accession is resolved through [seqout_counts()].
#' Requires SeuratObject.
#'
#' @param x A `seqout_matrix` from [seqout_matrix()], one GSE/GSM accession,
#'   or a `seqout_counts` tibble from [seqout_counts()].
#' @param sample Unit labels or sample accessions to read when `x` is a GSE or
#'   `seqout_counts`. `NULL` reads every preferred unit.
#' @param max_cells Cap on cells kept per unit, sampled at random. `NULL` keeps
#'   all cells.
#' @param multimodal Build one object per modality found, as extra assays.
#'   `FALSE` reads the preferred unit of each sample.
#' @param sample_metadata Join the study's sample record onto every cell, by the
#'   accession the cell came from. A column already in the cell metadata wins.
#' @param ... Passed to [SeuratObject::CreateSeuratObject()].
#'
#' @return A `Seurat` object.
#'
#' @seealso [seqout_matrix()] and [matrices()].
#'
#' @export
#' @examples
#' \dontrun{
#' obj <- Seqout2Seurat("GSM8994520", min.cells = 3)
#'
#' obj <- Seqout2Seurat("GSE297547", sample = "GSM8994520")
#' counts <- SeqoutListCounts("GSE297547")
#' obj <- Seqout2Seurat(counts, sample = "GSM8994520")
#' }
seqout_seurat <- function(x, sample = NULL, max_cells = NULL, multimodal = TRUE,
                          sample_metadata = FALSE, ...) {
  .need("SeuratObject", "Converting to a Seurat object")
  .seurat_multimodal(
    .converter_input(x, sample, max_cells, multimodal, sample_metadata), ...
  )
}

#' Read the modalities when the selection carries more than one, else NULL
#' @noRd
.maybe_modalities <- function(counts, sample, max_cells, multimodal) {
  if (!isTRUE(multimodal) || is.null(counts)) {
    return(NULL)
  }
  # Defer detection errors to the single-modality reader.
  groups <- tryCatch(
    suppressWarnings(.modal_groups(counts, sample)),
    error = function(e) NULL
  )
  if (is.null(groups)) {
    return(NULL)
  }
  groups <- groups[.modal_order(names(groups))]
  cli::cli_inform(
    "Reading {length(groups)} modalit{?y/ies} ({.val {names(groups)}}) as assays."
  )
  .read_modalities(counts, groups, max_cells = max_cells)
}

#' @noRd
.seurat_multimodal <- function(mods, ...) {
  lead <- mods[[1]]
  args <- list(...)
  args$counts <- lead$X
  if (is.null(args$meta.data) && ncol(lead$obs) > 0) {
    args$meta.data <- lead$obs
  }
  args$assay <- args$assay %||% .assay_name(names(mods)[[1]])
  obj <- do.call(SeuratObject::CreateSeuratObject, args)
  for (m in names(mods)[-1]) {
    X <- mods[[m]]$X[, colnames(obj), drop = FALSE]
    obj[[.assay_name(m)]] <- SeuratObject::CreateAssayObject(counts = X)
  }
  obj
}

#' Convert counts to a SingleCellExperiment
#'
#' `X` becomes `counts`; `obs` becomes `colData`; `var` becomes `rowData`.
#' A GSE or GSM accession is resolved through [seqout_counts()].
#' Requires SingleCellExperiment.
#'
#' @param x A `seqout_matrix` from [seqout_matrix()], one GSE/GSM accession,
#'   or a `seqout_counts` tibble from [seqout_counts()].
#' @param sample Unit labels or sample accessions to read when `x` is a GSE or
#'   `seqout_counts`. `NULL` reads every preferred unit.
#' @param max_cells Cap on cells kept per unit, sampled at random. `NULL` keeps
#'   all cells.
#' @param assay_name Assay name. Defaults to `"counts"`.
#' @param multimodal Carry the other modalities as `altExp` entries.
#'   `FALSE` reads the preferred unit of each sample.
#' @param sample_metadata Join the study's sample record onto every cell, by the
#'   accession the cell came from. A column already in the cell metadata wins.
#' @param ... Passed to [SingleCellExperiment::SingleCellExperiment()].
#'
#' @return A `SingleCellExperiment` object.
#'
#' @seealso [seqout_seurat()], [seqout_matrix()] and [matrices()].
#'
#' @export
#' @examples
#' \dontrun{
#' sce <- Seqout2SCE("GSM8994520")
#'
#' sce <- Seqout2SCE("GSE297547", sample = "GSM8994520")
#' counts <- SeqoutListCounts("GSE297547")
#' sce <- Seqout2SCE(counts, sample = "GSM8994520")
#' }
seqout_sce <- function(x, assay_name = "counts", sample = NULL, max_cells = NULL,
                       multimodal = TRUE, sample_metadata = FALSE, ...) {
  .need("SingleCellExperiment", "Converting to a SingleCellExperiment", bioc = TRUE)
  if (!rlang::is_string(assay_name)) {
    cli::cli_abort("{.arg assay_name} must be one name.")
  }
  .sce_multimodal(
    .converter_input(x, sample, max_cells, multimodal, sample_metadata),
    assay_name = assay_name, ...
  )
}

#' @noRd
.as_seqout_matrix <- function(x, sample = NULL, max_cells = NULL) {
  if (inherits(x, "seqout_matrix")) {
    return(x)
  }
  if (inherits(x, "seqout_counts")) {
    return(.counts_as_seqout_matrix(x, sample = sample, max_cells = max_cells))
  }
  if (!rlang::is_string(x)) {
    cli::cli_abort(
      "{.arg x} must be a {.cls seqout_matrix}, a {.cls seqout_counts} table, or one GSE/GSM accession."
    )
  }
  acc <- toupper(trimws(x))
  if (!grepl("^GS[EM][0-9]+$", acc)) {
    cli::cli_abort(c(
      "{.val {acc}} is not a GSE or GSM accession.",
      i = "Pass a {.cls seqout_matrix} or a {.cls seqout_counts} table."
    ))
  }
  counts <- seqout_counts(acc)
  if (startsWith(acc, "GSE") || !is.null(sample) || !is.null(max_cells)) {
    return(.counts_as_seqout_matrix(counts, sample = sample, max_cells = max_cells))
  }
  units <- counts[counts$preferred, , drop = FALSE]
  if (nrow(units) == 0) {
    cli::cli_abort(c(
      "{acc} ships no supplementary file that seqout can read as a matrix.",
      i = "{.code SeqoutCounts(\"{acc}\")} lists what it does ship."
    ))
  }
  if (nrow(units) > 1) {
    cli::cli_abort(c(
      "{acc} ships {nrow(units)} matrices, so there is no single one to convert.",
      i = "Pick one with {.fn seqout_matrix}, then pass that."
    ))
  }
  seqout_matrix(counts)
}

#' @noRd
.counts_as_seqout_matrix <- function(counts, sample = NULL, max_cells = NULL) {
  .check_counts(counts)
  units <- .select_units(counts, sample)
  if (length(units) == 0) {
    cli::cli_abort(c(
      "{counts$accession} has no selected count-matrix units.",
      i = "Inspect the table from {.fn seqout_counts}."
    ))
  }
  if (startsWith(counts$accession, "GSE") || length(units) > 1) {
    cli::cli_inform(
      "Reading {length(units)} count-matrix unit{?s} for {counts$accession}."
    )
  }
  mats <- matrices(counts, sample = sample)
  if (length(mats) == 0) {
    cli::cli_abort("{counts$accession}: no selected units could be read.")
  }
  .bind_units(mats, max_cells = max_cells)
}

#' Bind counts matrices across samples
#'
#' `join = "inner"`, the default, keeps the features common to every matrix and
#' warns when that drops any. Peak-by-cell matrices called per sample rarely
#' share a feature space, so the difference can be large.
#'
#' `join = "outer"` keeps the union and fills absent features with zero.
#' A zero there means "not in this matrix", not "measured as zero".
#'
#' Dense and sparse inputs may be mixed. Dense outer joins exceeding 5e7
#' elements use sparse storage to bound memory when features barely overlap.
#'
#' @param x A list of `seqout_matrix` objects, as [matrices()] returns.
#' @param labels Column-name prefix per matrix. Defaults to the list names.
#' @param max_cells Cap on columns kept per matrix, sampled at random. `NULL`
#'   keeps all; set a seed for reproducibility.
#' @param strict Stop rather than warn when the feature sets differ. Ignored
#'   for `join = "outer"`, which drops nothing.
#' @param join `"inner"` for the shared features, `"outer"` for the union with
#'   absent features zero-filled.
#'
#' @return A matrix, dgCMatrix if the inputs were sparse.
#'
#' @examples
#' \dontrun{
#' counts <- SeqoutCounts("GSE291735")
#' merged <- BindCounts(Matrices(counts, sample = wt$sample),
#'   labels = wt$stage, max_cells = 1200
#' )
#' }
#'
#' @export
bind_counts <- function(x, labels = NULL, max_cells = NULL, strict = FALSE,
                        join = c("inner", "outer")) {
  .bind_units(
    x,
    labels = labels, max_cells = max_cells, strict = strict,
    join = match.arg(join)
  )$X
}


#' Warn, or stop, when an inner join would drop features
#'
#' Peak-by-cell matrices called per sample rarely share a feature space, and
#' binding them on the intersection discards the difference in silence.
#' @noRd
.check_features <- function(labels, features, shared, strict = FALSE) {
  dropped <- lengths(features) - length(shared)
  if (all(dropped == 0)) {
    return(invisible(NULL))
  }
  worst <- order(dropped, decreasing = TRUE)[seq_len(min(3L, length(dropped)))]
  worst <- worst[dropped[worst] > 0]
  detail <- paste0(labels[worst], " loses ", dropped[worst])
  msg <- c(
    "The {length(features)} matrices do not share a feature space.",
    i = "{length(shared)} feature{?s} {?is/are} common to all; binding on them drops up to {max(dropped)} per matrix.",
    i = "{detail}"
  )
  if (isTRUE(strict)) {
    cli::cli_abort(msg)
  }
  cli::cli_warn(c(msg, i = "Pass {.code strict = TRUE} to make this an error."))
}


# Store large zero-padded unions sparsely to bound memory use.
.dense_element_limit <- 5e7

#' Whether the bound matrix has to be built sparse to fit
#'
#' Sparse inputs stay sparse. Dense outer joins can require sparse storage
#' when feature sets barely overlap.
#' @noRd
.bind_needs_sparse <- function(Xs, genes, n_cells, complete) {
  if (length(genes) > .Machine$integer.max) {
    cli::cli_abort(c(
      "The union of features has {length(genes)} rows, more than a matrix can hold.",
      i = 'Bind fewer units, or use {.code join = "inner"}.'
    ))
  }
  if (all(vapply(Xs, function(X) methods::is(X, "sparseMatrix"), logical(1)))) {
    return(FALSE)
  }
  if (all(complete)) {
    return(FALSE)
  }
  as.numeric(length(genes)) * as.numeric(n_cells) > .dense_element_limit
}

#' Reindex a matrix onto a feature set, filling absent rows with zero
#'
#' Absent features need new rows; zero fills preserve column sums.
#' @noRd
.align_rows <- function(X, genes, complete, sparse = FALSE) {
  if (isTRUE(complete)) {
    if (identical(rownames(X), genes)) {
      return(X)
    }
    return(X[genes, , drop = FALSE])
  }
  if (isTRUE(sparse) && !methods::is(X, "sparseMatrix")) {
    .need("Matrix", "Binding on the union of features")
    X <- methods::as(Matrix::Matrix(X, sparse = TRUE), "CsparseMatrix")
  }
  if (methods::is(X, "sparseMatrix")) {
    map <- match(rownames(X), genes)
    tr <- methods::as(X, "TsparseMatrix")
    keep <- !is.na(map[tr@i + 1L])
    return(Matrix::sparseMatrix(
      i = map[tr@i + 1L][keep], j = tr@j[keep] + 1L, x = tr@x[keep],
      dims = c(length(genes), ncol(X)),
      dimnames = list(genes, colnames(X)), repr = "C"
    ))
  }
  out <- matrix(vector(typeof(X), 1L),
    nrow = length(genes), ncol = ncol(X),
    dimnames = list(genes, colnames(X))
  )
  i <- match(genes, rownames(X))
  keep <- !is.na(i)
  out[keep, ] <- X[i[keep], , drop = FALSE]
  out
}

#' @noRd
.bind_units <- function(x, labels = NULL, max_cells = NULL, strict = FALSE,
                        join = c("inner", "outer")) {
  join <- match.arg(join)
  if (!is.list(x) || length(x) == 0) {
    cli::cli_abort("{.arg x} must be a non-empty list of {.cls seqout_matrix} objects.")
  }
  x <- lapply(x, .check_seqout_matrix)
  Xs <- lapply(x, function(m) m$X)
  features <- lapply(Xs, rownames)
  genes <- Reduce(if (join == "outer") union else intersect, features)
  if (length(genes) == 0) {
    cli::cli_abort(c(
      "The {length(Xs)} matrices share no features.",
      i = 'Pass {.code join = "outer"} to keep the union instead.'
    ))
  }
  labels <- .bind_labels(x, labels)
  # the sample accession is the prefix that lets modalities line up by cell
  labels <- vapply(seq_along(x), function(i) .unit_sample_label(x[[i]], labels[i]), character(1))
  if (join == "inner") {
    .check_features(labels, features, genes, strict = strict)
  }
  max_cells <- .check_max_cells(max_cells)
  n_cells <- sum(vapply(
    Xs, function(X) min(ncol(X), max_cells %||% ncol(X)), numeric(1)
  ))
  # one hash of genes per unit, shared by the storage decision and the reindex
  complete <- vapply(Xs, function(X) all(genes %in% rownames(X)), logical(1))
  as_sparse <- .bind_needs_sparse(Xs, genes, n_cells, complete)
  if (as_sparse) {
    cli::cli_inform(c(
      "Binding {length(genes)} features x {n_cells} cells as a sparse matrix.",
      i = "A dense one would allocate {format(as.numeric(length(genes)) * n_cells, big.mark = ',', scientific = FALSE)} elements, nearly all of them zero."
    ))
  }
  obs_cols <- unique(unlist(lapply(x, function(m) names(m$obs)), use.names = FALSE))
  sample_labels <- labels
  # a deposited obs often names a column "sample" itself; keep the author's
  kept <- if ("sample" %in% obs_cols) make.unique(c(obs_cols, "sample_orig"))[length(obs_cols) + 1L] else NULL
  if (!is.null(kept)) {
    cli::cli_warn("A unit names an {.field obs} column {.field sample}; it is kept as {.field {kept}}.")
    obs_cols[obs_cols == "sample"] <- kept
  }

  parts <- Map(function(m, label, sample_label, whole) {
    X <- m$X
    i <- if (!is.null(max_cells) && ncol(X) > max_cells) {
      sort(sample.int(ncol(X), max_cells))
    } else {
      seq_len(ncol(X))
    }
    cell_names <- colnames(X)
    if (is.null(cell_names)) {
      cell_names <- as.character(seq_len(ncol(X)))
    }
    obs <- .unit_obs(m, ncol(X), cell_names)
    obs <- obs[i, , drop = FALSE]
    if (!is.null(kept) && "sample" %in% names(obs)) {
      names(obs)[names(obs) == "sample"] <- kept
    }
    for (nm in setdiff(obs_cols, names(obs))) {
      obs[[nm]] <- NA
    }
    if (length(obs_cols) > 0) {
      obs <- obs[obs_cols]
    }
    obs[["sample"]] <- sample_label

    # subsetting an unsubsampled matrix would copy it for nothing
    if (length(i) < ncol(X)) {
      X <- X[, i, drop = FALSE]
    }
    X <- .align_rows(X, genes, complete = whole, sparse = as_sparse)
    new_names <- paste0(label, "_", cell_names[i])
    colnames(X) <- new_names
    rownames(obs) <- new_names
    list(X = X, obs = obs)
  }, x, labels, sample_labels, complete)

  X <- do.call(cbind, lapply(parts, function(p) p$X))
  obs <- do.call(rbind, unname(lapply(parts, function(p) p$obs)))
  # an unmeasured antibody arrives as an all-NA row, which nulls any column sum
  blank <- .all_na_rows(X)
  if (blank > 0) {
    cli::cli_warn(c(
      "{blank} of {nrow(X)} features are NA in every cell.",
      i = "Per-cell totals over them are NA; drop them before normalising."
    ))
  }
  if (anyDuplicated(colnames(X))) {
    fixed <- make.unique(colnames(X), sep = "_")
    colnames(X) <- fixed
    rownames(obs) <- fixed
  }

  structure(
    list(
      X = X, obs = obs, var = .bind_var(x, genes),
      kind = .bind_kind(x), evidence = "bound from count-matrix units",
      fmt = paste(unique(vapply(x, function(m) m$fmt %||% NA_character_, character(1))),
        collapse = ", "
      ),
      accession = paste(unique(sample_labels), collapse = ", "),
      source = paste(unique(vapply(x, function(m) m$source %||% "", character(1))),
        collapse = ", "
      )
    ),
    class = "seqout_matrix"
  )
}

#' @noRd
.bind_labels <- function(x, labels = NULL) {
  labels <- labels %||% names(x)
  if (is.null(labels)) {
    labels <- seq_along(x)
  }
  if (length(labels) != length(x)) {
    cli::cli_abort("{.arg labels} must have one value per matrix.")
  }
  labels <- as.character(labels)
  blank <- is.na(labels) | !nzchar(labels)
  labels[blank] <- as.character(seq_along(labels)[blank])
  labels
}

#' @noRd
.unit_sample_label <- function(x, label) {
  sample <- x$sample %||% NA_character_
  if (length(sample) == 1L && !is.na(sample) && nzchar(sample)) {
    return(as.character(sample))
  }
  accession <- x$accession %||% NA_character_
  if (length(accession) == 1L && !is.na(accession) && startsWith(accession, "GSM")) {
    return(as.character(accession))
  }
  as.character(label)
}

#' @noRd
.check_max_cells <- function(max_cells) {
  if (is.null(max_cells)) {
    return(NULL)
  }
  if (!is.numeric(max_cells) || length(max_cells) != 1L ||
    is.na(max_cells) || max_cells < 1 || max_cells != floor(max_cells)) {
    cli::cli_abort("{.arg max_cells} must be a positive integer or {.code NULL}.")
  }
  as.integer(max_cells)
}

#' @noRd
.unit_obs <- function(x, n_cells, cell_names) {
  obs <- x$obs
  if (!is.data.frame(obs) || nrow(obs) != n_cells) {
    return(data.frame(row.names = make.unique(cell_names)))
  }
  as.data.frame(obs, stringsAsFactors = FALSE, optional = TRUE)
}

#' @noRd
.bind_var <- function(x, genes) {
  for (m in x) {
    var <- m$var
    if (is.data.frame(var) && all(genes %in% rownames(var))) {
      out <- var[genes, , drop = FALSE]
      rownames(out) <- genes
      return(out)
    }
  }
  data.frame(row.names = genes)
}

#' @noRd
.bind_kind <- function(x) {
  kinds <- unique(vapply(x, function(m) m$kind %||% NA_character_, character(1)))
  kinds <- kinds[!is.na(kinds)]
  if (length(kinds) == 1L) {
    return(kinds)
  }
  if ("single_cell" %in% kinds) {
    return("single_cell")
  }
  "unknown"
}

#' @noRd
.transpose <- function(X) {
  if (methods::is(X, "Matrix")) Matrix::t(X) else t(X)
}

#' @noRd
.check_seqout_matrix <- function(x) {
  if (!inherits(x, "seqout_matrix")) {
    cli::cli_abort("{.arg x} must be a {.cls seqout_matrix} (from {.fn seqout_matrix}).")
  }
  x
}


#' Read every preferred unit
#'
#' Broken units are skipped with a warning.
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()].
#' @param sample Unit labels or sample accessions to read. `NULL` reads every
#'   preferred unit.
#'
#' @return A named list of `seqout_matrix` objects, keyed by unit label.
#'
#' @export
matrices <- function(counts, sample = NULL) {
  .check_counts(counts)
  units <- .select_units(counts, sample)
  .prefetch_units(counts, units)
  .read_units(counts, units)
}

#' Download every file the units need, in one batch
#' @noRd
.prefetch_units <- function(counts, units) {
  urls <- unique(unlist(lapply(units, .unit_urls), use.names = FALSE))
  if (length(urls) > 0) {
    .download_files(urls, counts$cache_dir)
  }
  invisible(urls)
}

#' Read units into a named list, skipping the ones that will not parse
#' @noRd
.read_units <- function(counts, units, key = function(u) u$label) {
  out <- list()
  for (u in units) {
    m <- tryCatch(.read_unit(counts, u), error = function(e) {
      cli::cli_warn("Could not read {u$label}: {conditionMessage(e)}")
      NULL
    })
    if (!is.null(m)) out[[key(u)]] <- m
  }
  out
}

#' @noRd
.select_units <- function(counts, sample = NULL) {
  if (is.null(sample)) {
    return(.counts_units(counts, preferred_only = TRUE))
  }
  lapply(as.character(sample), function(s) .select_unit(counts, s))
}

#' @noRd
.check_counts <- function(x) {
  if (!inherits(x, "seqout_counts")) {
    cli::cli_abort("{.arg counts} must be a {.cls seqout_counts} (from {.fn seqout_counts}).")
  }
  invisible(x)
}

#' @noRd
.select_unit <- function(counts, sample) {
  all_units <- .counts_units(counts, preferred_only = FALSE)
  preferred <- vapply(all_units, function(u) isTRUE(u$preferred), logical(1))
  if (is.null(sample)) {
    preferred_units <- all_units[preferred]
    if (length(preferred_units) != 1) {
      cli::cli_abort(c(
        "{counts$accession} has {length(preferred_units)} units.",
        "i" = "Pass {.arg sample}, or use {.fn matrices}. Inspect the table from {.fn seqout_counts}."
      ))
    }
    return(preferred_units[[1]])
  }
  want <- toupper(trimws(sample))
  labels <- toupper(vapply(all_units, function(u) u$label, character(1)))
  hit <- match(want, labels)
  if (!is.na(hit)) {
    return(all_units[[hit]])
  }
  samples <- toupper(vapply(all_units, function(u) u$sample %||% "", character(1)))
  hit <- which(samples == want & preferred)
  if (length(hit) == 0) {
    cli::cli_abort("No unit for {.val {sample}}; inspect the table from {.fn seqout_counts}.")
  }
  all_units[[hit[1]]]
}

#' @noRd
.unit_urls <- function(unit) {
  unique(c(
    vapply(unit$files, function(f) f$url, character(1)),
    vapply(unit$metadata_files, function(f) f$url, character(1))
  ))
}

#' Extract and regroup a tar archive
#'
#' Regrouping assembles loose 10x triplets. The marker directory caches extraction.
#'
#' @param counts A seqout_counts object.
#' @param unit The tar unit to expand.
#'
#' @return The preferred unit found inside the archive.
#' @noRd
.expand_tar <- function(counts, unit) {
  .fetch_unit(counts, unit)
  tar_path <- .unit_paths(counts, .unit_urls(unit))[1]
  dest <- paste0(tar_path, ".extracted")

  if (!dir.exists(dest)) {
    members <- utils::untar(tar_path, list = TRUE)
    members <- members[file_role(members) != "skip"]
    if (length(members) == 0) {
      cli::cli_abort("{basename(tar_path)}: no readable matrix inside.")
    }
    # extract to scratch and rename; partial dest must fail cache trust
    tmp <- tempfile("untar", tmpdir = counts$cache_dir)
    utils::untar(tar_path, files = members, exdir = tmp)
    file.rename(tmp, dest)
  }

  paths <- list.files(dest, recursive = TRUE, full.names = TRUE)
  roles <- file_role(paths)
  keep <- which(roles != "skip")
  if (length(keep) == 0) {
    cli::cli_abort("{basename(tar_path)}: no readable matrix inside.")
  }

  rows <- lapply(keep, function(i) {
    name <- basename(paths[i])
    gsm <- regmatches(name, regexpr("GSM[0-9]+", name))
    list(
      url = paths[i], role = roles[i],
      sample = if (length(gsm)) gsm else NA_character_,
      platform = NA_character_,
      member = substring(paths[i], nchar(dest) + 2L),
      name = name
    )
  })

  units <- .group_units(.records_to_tibble(rows), counts$accession, counts$assay)
  if (length(units) == 0) {
    cli::cli_abort("{basename(tar_path)}: no readable matrix inside.")
  }
  preferred <- Filter(function(u) isTRUE(u$preferred), units)
  if (length(preferred) > 0) {
    units <- preferred
  }
  if (length(units) > 1) {
    cli::cli_alert_info(
      "{basename(tar_path)} holds {length(units)} units; reading the first
       ({units[[1]]$label}). Extracted to {.path {dest}}."
    )
  }
  units[[1]]
}

#' Whether a unit URL is a local path
#'
#' Extracted tar members use local paths, so fetching must skip them.
#' @noRd
.is_local_path <- function(x) {
  !grepl("^[A-Za-z][A-Za-z0-9+.-]*://", x)
}

#' @noRd
.unit_paths <- function(counts, urls) {
  ifelse(.is_local_path(urls), urls, file.path(counts$cache_dir, basename(urls)))
}

#' @noRd
.fetch_unit <- function(counts, unit) {
  urls <- .unit_urls(unit)
  .download_files(urls[!.is_local_path(urls)], counts$cache_dir)
}

#' @noRd
.read_unit <- function(counts, unit) {
  if (identical(unit$fmt, "tar")) {
    return(.read_unit(counts, .expand_tar(counts, unit)))
  }
  .fetch_unit(counts, unit)
  file_roles <- vapply(unit$files, function(f) f$role, character(1))
  file_urls <- vapply(unit$files, function(f) f$url, character(1))
  file_names <- vapply(unit$files, function(f) f$name, character(1))
  first_role <- !duplicated(file_roles)
  by_role <- as.list(.unit_paths(counts, file_urls[first_role]))
  names(by_role) <- file_roles[first_role]

  parsed <- switch(unit$fmt,
    "10x_mtx" = .read_10x_mtx(
      by_role[["mtx"]], by_role[["barcodes"]], by_role[["features"]],
      feature_type = counts$feature_type
    ),
    "10x_h5" = .read_10x_h5(by_role[["h5"]], feature_type = counts$feature_type),
    "h5ad" = .read_h5ad(by_role[["h5ad"]]),
    "rds" = .read_rds(by_role[["rds"]], assay = counts$assay),
    "table" = .read_table(by_role[["table"]]),
    cli::cli_abort("{unit$label}: no reader for format {.val {unit$fmt}}.")
  )

  n_samples <- if (exists("n_samples", envir = counts$cache, inherits = FALSE)) {
    base::get("n_samples", envir = counts$cache)
  } else {
    0L
  }
  decided <- if (unit$fmt %in% c("10x_mtx", "10x_h5", "h5ad")) {
    list(kind = "single_cell", evidence = paste(unit$fmt, "file"))
  } else {
    .infer_kind(rownames(parsed$obs), n_samples)
  }

  X <- .transpose(parsed$X)
  dimnames(X) <- list(rownames(parsed$var), rownames(parsed$obs))

  structure(
    list(
      X = X, obs = parsed$obs, var = parsed$var,
      kind = decided$kind, evidence = decided$evidence,
      fmt = unit$fmt, accession = unit$sample %||% counts$accession,
      sample = unit$sample %||% NA_character_, unit = unit$label,
      source = paste(file_names, collapse = ", ")
    ),
    class = "seqout_matrix"
  )
}

#' @export
print.seqout_matrix <- function(x, ...) {
  label <- if (identical(x$kind, "single_cell")) "cells" else "obs"
  cli::cli_inform(c(
    "{.cls seqout_matrix}",
    " " = "{x$accession}: {nrow(x$X)} genes x {ncol(x$X)} {label}",
    " " = "Kind:   {x$kind}",
    " " = "Format: {x$fmt}",
    " " = "Source: {x$source}"
  ))
  invisible(x)
}

#' The modality a unit carries, from its file names
#' @noRd
.unit_modality <- function(u) {
  names <- vapply(u$files, function(f) f$name, character(1))
  found <- stats::na.omit(.modality_in_vec(names))
  if (length(found) == 0) NA_character_ else found[[1]]
}

#' Group selected units by modality, keyed by sample
#'
#' Only samples carrying more than one modality can make a multimodal object.
#' @noRd
.modal_groups <- function(counts, sample = NULL) {
  units <- .counts_units(counts, preferred_only = FALSE)
  if (!is.null(sample)) {
    want <- toupper(trimws(as.character(sample)))
    keep <- vapply(units, function(u) {
      toupper(u$label) %in% want || toupper(u$sample %||% "") %in% want
    }, logical(1))
    units <- units[keep]
  }
  mods <- vapply(units, .unit_modality, character(1))
  units <- units[!is.na(mods)]
  mods <- mods[!is.na(mods)]
  if (length(units) == 0) {
    return(NULL)
  }
  keys <- vapply(units, function(u) u$sample %||% NA_character_, character(1))
  if (anyNA(keys)) {
    return(NULL)
  }
  per_sample <- split(mods, keys)
  if (!any(vapply(per_sample, function(m) length(unique(m)) > 1L, logical(1)))) {
    return(NULL)
  }
  # a sample missing a modality the others have would misalign the assays
  shared <- Reduce(intersect, lapply(per_sample, unique))
  if (length(shared) < 2L) {
    return(NULL)
  }
  out <- lapply(shared, function(m) .one_unit_per_sample(units[mods == m], m))
  stats::setNames(out, shared)
}

#' Keep the best-ranked unit for each sample within a modality
#'
#' Units of the same modality share a sample key; extra formats or raw
#' copies would overwrite the preferred unit.
#' @noRd
.one_unit_per_sample <- function(units, assay) {
  keys <- vapply(units, function(u) u$sample %||% NA_character_, character(1))
  if (!anyDuplicated(keys)) {
    return(units)
  }
  ranks <- .unit_ranks(units, assay)
  best <- vapply(
    split(seq_along(units), keys),
    function(i) i[which.min(ranks[i])], integer(1)
  )
  units[sort(best)]
}

#' Read each modality into one matrix, on the cells they share
#'
#' Binding uses the sample accession as the cell-name prefix, so the same cell
#' carries the same name in every modality.
#' @noRd
.read_modalities <- function(counts, groups, max_cells = NULL) {
  read_group <- function(units) {
    mats <- .read_units(counts, units, key = function(u) u$sample %||% u$label)
    if (length(mats) == 0) NULL else .bind_units(mats, labels = names(mats))
  }
  .prefetch_units(counts, unlist(groups, recursive = FALSE))
  out <- Filter(Negate(is.null), lapply(groups, read_group))
  if (length(out) < 2L) {
    return(NULL)
  }
  cells <- Reduce(intersect, lapply(out, function(m) colnames(m$X)))
  if (length(cells) == 0) {
    cli::cli_warn(
      "The {length(out)} modalities share no cell names, so they stay separate."
    )
    return(NULL)
  }
  if (!is.null(max_cells) && length(cells) > max_cells) {
    cells <- cells[sort(sample.int(length(cells), max_cells))]
  }
  lapply(out, function(m) {
    m$X <- m$X[, cells, drop = FALSE]
    m$obs <- m$obs[cells, , drop = FALSE]
    m
  })
}


#' @noRd
.sce_multimodal <- function(mods, assay_name = "counts", ...) {
  lead <- mods[[1]]
  args <- list(...)
  args$assays <- stats::setNames(list(lead$X), assay_name)
  if (is.null(args$colData) && ncol(lead$obs) > 0) {
    args$colData <- lead$obs
  }
  if (is.null(args$rowData) && ncol(lead$var) > 0) {
    args$rowData <- lead$var
  }
  sce <- do.call(SingleCellExperiment::SingleCellExperiment, args)
  for (m in names(mods)[-1]) {
    alt <- SingleCellExperiment::SingleCellExperiment(
      assays = stats::setNames(list(mods[[m]]$X), assay_name)
    )
    SingleCellExperiment::altExp(sce, .assay_name(m)) <- alt
  }
  sce
}

#' Count features that are NA in every cell, without densifying
#'
#' A sparse matrix stores NA explicitly, so a row is wholly NA only when it
#' holds one NA per column.
#' @noRd
.all_na_rows <- function(X) {
  if (!methods::is(X, "sparseMatrix")) {
    # anyNA scans without allocating; the common case leaves here
    if (!anyNA(X)) {
      return(0L)
    }
    return(sum(rowSums(is.na(X)) == ncol(X)))
  }
  if (!anyNA(X@x)) {
    return(0L)
  }
  rows <- X@i[is.na(X@x)] + 1L
  sum(tabulate(rows, nrow(X)) == ncol(X))
}

#' Join the study's sample record onto the cells
#'
#' Sample accessions link cells to sample metadata. Existing `obs` columns
#' win because the submitter's per-cell values are more specific.
#' @noRd
.attach_sample_metadata <- function(m, counts) {
  if (is.null(counts) || !"sample" %in% names(m$obs)) {
    return(m)
  }
  rows <- tryCatch(.sample_rows(counts), error = function(e) NULL)
  if (is.null(rows) || nrow(rows) == 0) {
    return(m)
  }
  rows <- as.data.frame(rows)
  add <- setdiff(names(rows), c(names(m$obs), "accession"))
  i <- match(m$obs$sample, rows$accession)
  for (nm in add) {
    value <- rows[[nm]][i]
    # a list column would not survive into meta.data
    if (!is.list(value)) m$obs[[nm]] <- value
  }
  m
}

#' The study's sample table, reusing the counts handle's cache
#'
#' `.counts_files()` fetches this table for a GSE; reuse avoids another request.
#' @noRd
.sample_rows <- function(counts) {
  cached <- counts$cache
  rows <- if (!is.null(cached) && exists("samples", envir = cached, inherits = FALSE)) {
    base::get("samples", envir = cached)
  } else {
    seqout_get(counts$accession, con = counts$con)$samples
  }
  # both paths spread the characteristics, so callers see one shape either way
  .unnest_characteristics(rows)
}

#' The counts handle behind whatever the caller passed
#' @noRd
.counts_of <- function(x, assay = "rna") {
  if (inherits(x, "seqout_counts")) {
    return(x)
  }
  if (rlang::is_string(x) && grepl("^GS[EM][0-9]+$", toupper(trimws(x)))) {
    return(tryCatch(seqout_counts(toupper(trimws(x)), assay = assay),
      error = function(e) NULL
    ))
  }
  NULL
}


#' Split a multiome unit into one matrix per feature class
#'
#' A 10x multiome stores genes and peaks in one matrix, identified by feature type.
#' @noRd
.split_feature_types <- function(m) {
  types <- m$var[["feature_type"]]
  if (is.null(types)) {
    return(NULL)
  }
  mods <- .feature_type_modality(types)
  known <- !is.na(mods)
  if (length(unique(mods[known])) < 2L) {
    return(NULL)
  }
  if (any(!known)) {
    dropped <- unique(as.character(types)[!known])
    cli::cli_warn(c(
      "{sum(!known)} feature{?s} of an unknown class {?is/are} left out of the assays.",
      i = "Unmapped: {.val {dropped}}."
    ))
  }
  parts <- lapply(split(which(known), mods[known]), function(i) {
    m$X <- m$X[i, , drop = FALSE]
    m$var <- m$var[i, , drop = FALSE]
    m
  })
  parts[.modal_order(names(parts))]
}

#' Fragments files for an ATAC study
#'
#' A fragments file holds one bgzipped BED-like row per ATAC fragment, with
#' columns `chrom`, `start`, `end`, `barcode` and `read_support`.
#'
#' Files download only when `download = TRUE`.
#'
#' GEO rarely holds the `.tbi` index Signac wants. Build one after downloading
#' with `Rsamtools::indexTabix(path, format = "bed")`.
#'
#' That works on a CellRanger fragments file, which is bgzipped and sorted by
#' coordinate. Some deposits are neither: GSE184462 ships plain-gzipped files
#' sorted by barcode, and tabix rejects them with "Chromosome blocks not
#' continuous". Sort and recompress first:
#' `sort -k1,1 -k2,2n`, then `Rsamtools::bgzip()`, then `indexTabix()`.
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()].
#' @param sample Sample accessions to keep. `NULL` returns every fragments file
#'   in the study.
#' @param download Fetch the files and report where they landed. `FALSE`, the
#'   default, only lists them.
#'
#' @return A tibble of `sample`, `file`, `url`, `indexed` and `path`. `path` is
#'   `NA` until the file is downloaded.
#'
#' @seealso [seqout_counts()] for the matrices, [seqout_counts_files()] for a
#'   unit's own files.
#'
#' @export
#' @examples
#' \dontrun{
#' counts <- SeqoutListCounts("GSE156478")
#' SeqoutFragments(counts)
#'
#' frags <- SeqoutFragments(counts, sample = "GSM5065524", download = TRUE)
#' Rsamtools::indexTabix(frags$path[1], format = "bed")
#' }
seqout_fragments <- function(counts, sample = NULL, download = FALSE) {
  .check_counts(counts)
  rows <- .counts_files(counts)
  keep <- .is_fragments(rows$name)
  if (!is.null(sample)) {
    keep <- keep & rows$sample %in% toupper(trimws(as.character(sample)))
  }
  out <- tibble::tibble(
    sample = rows$sample[keep], file = rows$name[keep], url = rows$url[keep],
    indexed = paste0(rows$url[keep], ".tbi") %in% rows$url,
    path = NA_character_
  )
  out <- out[order(out$sample, out$file), , drop = FALSE]
  if (nrow(out) == 0) {
    cli::cli_warn(c(
      "{counts$accession} lists no fragments file.",
      i = "Only ATAC and multiome studies ship one."
    ))
    return(out)
  }
  if (isTRUE(download)) {
    .download_files(out$url, counts$cache_dir)
    # .dest_paths holds downloaded names in request order.
    out$path <- .dest_paths(out$url, counts$cache_dir)
  }
  if (!any(out$indexed)) {
    cli::cli_inform(
      "No {.file .tbi} index is deposited; build one with {.fn Rsamtools::indexTabix}."
    )
  }
  out
}


#' A named list of matrices, one per assay, for both converters
#'
#' Resolving the counts handle once avoids repeated manifest reads.
#' @noRd
.converter_input <- function(x, sample, max_cells, multimodal, sample_metadata) {
  counts <- .counts_of(x, assay = if (isTRUE(multimodal)) NULL else "rna")
  mods <- .maybe_modalities(counts, sample, max_cells, multimodal)
  if (is.null(mods)) {
    # Reuse counts handles; other inputs resolve through x for error reporting.
    from <- if (inherits(counts, "seqout_counts")) counts else x
    mods <- list(rna = .as_seqout_matrix(from, sample = sample, max_cells = max_cells))
  }
  if (isTRUE(sample_metadata)) {
    mods[[1]] <- .attach_sample_metadata(mods[[1]], counts)
  }
  if (isTRUE(multimodal)) mods <- .expand_feature_types(mods) else mods
}

#' Split any modality that turns out to carry several feature classes
#'
#' A 10x multiome can carry several feature classes under one filename.
#' CellRanger feature classes take precedence; existing class matrices are kept.
#' @noRd
.expand_feature_types <- function(mods) {
  out <- list()
  for (nm in names(mods)) {
    parts <- .split_feature_types(mods[[nm]])
    if (is.null(parts)) {
      if (is.null(out[[nm]])) out[[nm]] <- mods[[nm]]
      next
    }
    cli::cli_inform(
      "Splitting {nrow(mods[[nm]]$X)} features into {length(parts)} assay{?s} ({.val {names(parts)}})."
    )
    for (pn in names(parts)) {
      if (is.null(out[[pn]])) out[[pn]] <- parts[[pn]]
    }
  }
  out[.modal_order(names(out))]
}
