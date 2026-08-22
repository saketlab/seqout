#' List counts matrices for a GEO accession
#'
#' Resolves the supplementary files of a series or sample and groups them into
#' readable units, downloading nothing. GEO payloads run to tens of gigabytes,
#' so this returns a table first and costs only the calls that list files.
#'
#' A unit is the smallest group of supplementary files that Seqout can read as
#' one matrix. It may be a 10x triplet
#' (`matrix.mtx` with `barcodes.tsv` and `features.tsv`), a CellRanger `.h5`, an
#' `.h5ad`, an `.rds`, or a delimited table.
#'
#' The result has one row per unit. `unit` is its selection label, `sample` is
#' its GSM when known, `format` is its reader, and `files` names its matrix
#' files. `has_metadata` is `TRUE` for an `.h5ad` or `.rds`, which can embed
#' observation annotation, or when a sidecar file is named like cell metadata
#' or annotation. A `TRUE` value signals that metadata was found by format or
#' filename; its contents are read only by [seqout_matrix()].
#'
#' `preferred` marks the unit [seqout_matrix()] selects when given a GSM rather
#' than a unit label. Within a sample, the requested assay ranks first, then
#' filtered output over raw or unfiltered output, then format: 10x MatrixMarket,
#' 10x HDF5, `.h5ad`, `.rds`, tar, and a delimited table. The other units remain
#' selectable by `unit`.
#'
#' `assay` may be one of `"rna"`, `"adt"`, `"hto"` or `"atac"`, or `NULL` to
#' avoid assay preference. It is identified from filename hints: RNA/GEX,
#' antibody/CITE-seq, hashtag, and ATAC/peak respectively. For 10x data it also
#' chooses the matching feature class: Gene Expression, Antibody Capture, or
#' Peaks. Set `feature_type` to override this filter.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A GSE or GSM accession.
#' @param assay Assay preference: `"rna"` (default), `"adt"`, `"hto"`,
#'   `"atac"`, or `NULL` for no preference. It selects the preferred unit when
#'   a sample carries several, as in CITE-seq and multiome data.
#' @param feature_type 10x feature class to keep, overriding the one implied by
#'   `assay`. `NULL` keeps every row.
#' @param cache_dir Where downloads land. Defaults to a per-accession directory
#'   under [tools::R_user_dir()], reused across sessions.
#'
#' @return A tibble, one row per readable unit. Pass it directly to
#'   [seqout_matrix()], [matrices()] or [seqout_counts_files()].
#'
#' @export
#' @examples
#' \dontrun{
#' counts <- SeqoutCounts("GSE297547")
#' counts[, c("unit", "sample", "format", "preferred")]
#' m <- SeqoutMatrix(counts, sample = "GSM8994520")
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
    feature_type <- .assay_feature_type[[assay]]
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

#' @noRd
.assay_feature_type <- list(
  rna = "Gene Expression",
  adt = "Antibody Capture",
  hto = "Antibody Capture",
  atac = "Peaks"
)

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

#' Supplementary URLs out of parsed JSON records
#'
#' Each element is either a bare URL string or an object carrying it under
#' `#text` or `url`.
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

#' Supplementary URLs out of the JSON column GEO stores them in
#'
#' Each element is either a bare URL string or an object carrying it under
#' `#text` or `url`.
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
#' The API answers one accession per request, which costs a round trip per
#' sample; the same JSON sits in a column DuckDB can unnest for the whole
#' series at once. Falls back to the API when the query cannot be answered.
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
#' Filters a study's samples through [sample_search()] and keeps the ones that
#' have a readable unit. Use it on a series that mixes tissues or assays.
#'
#' @param counts A `seqout_counts` tibble from [seqout_counts()], built on a
#'   GSE.
#' @param ... Filters for [sample_search()], by name, such as
#'   `tissue = "liver"`. `study_accession` comes from `counts`.
#' @param min_cell_count Smallest cell count to keep. Samples with no recorded
#'   count go too; `NULL` keeps everything.
#'
#' @return A tibble of the matching samples, sorted by highest cells first,
#' with the `unit`  and `format` [seqout_matrix()] would read.
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
#' Hands a matrix to [SeuratObject::CreateSeuratObject()]. The matrix is
#' already features by observations, the orientation Seurat expects, and the
#' per-cell annotation becomes `meta.data`.
#'
#' A GSM accession is read first, through [seqout_counts()] and
#' [seqout_matrix()]. Use those two yourself for a series, for a sample that
#' ships more than one matrix, or for an assay other than RNA.
#'
#' The SeuratObject package must be installed; Seurat brings it.
#'
#' @param x A `seqout_matrix` from [seqout_matrix()], or one GSM accession.
#' @param ... Passed to [SeuratObject::CreateSeuratObject()], such as
#'   `project`, `assay`, `min.cells` or `min.features`. The counts come from
#'   `x`, and `meta.data` too unless you give your own.
#'
#' @return A `Seurat` object.
#'
#' @seealso [seqout_matrix()] for the matrix without Seurat, and [matrices()]
#'   with `lapply()` for a whole series.
#'
#' @export
#' @examples
#' \dontrun{
#' obj <- Seqout2Seurat("GSM8994520", min.cells = 3)
#'
#' counts <- SeqoutCounts("GSE297547")
#' obj <- Seqout2Seurat(SeqoutMatrix(counts, sample = "GSM8994520"))
#' }
seqout_seurat <- function(x, ...) {
  .need("SeuratObject")
  m <- if (inherits(x, "seqout_matrix")) x else .matrix_from_accession(x)
  args <- list(...)
  args$counts <- m$X
  if (is.null(args$meta.data) && ncol(m$obs) > 0) {
    args$meta.data <- m$obs
  }
  do.call(SeuratObject::CreateSeuratObject, args)
}

#' @noRd
.matrix_from_accession <- function(x) {
  if (!is.character(x) || length(x) != 1L || is.na(x)) {
    cli::cli_abort("{.arg x} must be a {.cls seqout_matrix} or one GSM accession.")
  }
  acc <- toupper(trimws(x))
  if (!startsWith(acc, "GSM")) {
    cli::cli_abort(c(
      "{.val {acc}} is not a GSM accession.",
      i = "Read a series with {.fn seqout_counts}, then one sample of it with {.fn seqout_matrix}."
    ))
  }
  counts <- seqout_counts(acc)
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

#' Bind counts matrices across samples
#'
#' @param x A list of `seqout_matrix` objects, as [matrices()] returns.
#' @param labels Column-name prefix per matrix. Defaults to the list names,
#' @param max_cells Cap on columns kept per matrix, sampled at random. `NULL`
#'   keeps all; set a seed for reproducibility.
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
bind_counts <- function(x, labels = NULL, max_cells = NULL) {
  if (!is.list(x) || length(x) == 0) {
    cli::cli_abort("{.arg x} must be a non-empty list of {.cls seqout_matrix} objects.")
  }
  Xs <- lapply(x, .counts_X)
  genes <- Reduce(intersect, lapply(Xs, rownames))
  if (length(genes) == 0) {
    cli::cli_abort("The {length(Xs)} matrices share no features.")
  }
  labels <- labels %||% names(x) %||% seq_along(x)

  out <- Map(function(X, label) {
    i <- if (!is.null(max_cells) && ncol(X) > max_cells) {
      sort(sample.int(ncol(X), max_cells))
    } else {
      seq_len(ncol(X))
    }
    X <- X[genes, i, drop = FALSE]
    colnames(X) <- paste0(label, "_", colnames(X) %||% seq_along(i))
    X
  }, Xs, labels)
  do.call(cbind, out)
}

#' @noRd
.transpose <- function(X) {
  if (methods::is(X, "Matrix")) Matrix::t(X) else t(X)
}

.counts_X <- function(x) {
  if (!inherits(x, "seqout_matrix")) {
    cli::cli_abort("{.arg x} must be a {.cls seqout_matrix} (from {.fn seqout_matrix}).")
  }
  x$X
}

#' Read every preferred unit
#'
#' Units that cannot be read are skipped with a warning, so one broken file does
#' not fail the whole call. Compare the length against the rows returned by
#' [seqout_counts()].
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
  units <- if (is.null(sample)) {
    .counts_units(counts, preferred_only = TRUE)
  } else {
    lapply(sample, function(s) .select_unit(counts, s))
  }

  urls <- unique(unlist(lapply(units, .unit_urls), use.names = FALSE))
  if (length(urls) > 0) {
    .download_files(urls, counts$cache_dir)
  }

  out <- list()
  for (u in units) {
    m <- tryCatch(.read_unit(counts, u), error = function(e) {
      cli::cli_warn("Could not read {u$label}: {conditionMessage(e)}")
      NULL
    })
    if (!is.null(m)) out[[u$label]] <- m
  }
  out
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

#' Read a tar archive by extracting its matrix members and regrouping them
#'
#' GEO ships plenty of series as a single `_RAW.tar`, so the matrices are inside
#' the archive rather than beside it. Extract the members that carry a role,
#' then hand them back through `.group_units()` so a tar full of loose 10x
#' triplets assembles exactly as it would have if GEO had listed those files
#' individually. Extraction happens once; the marker directory is the cache.
#'
#' Mirrors the Python client's `SeqoutCounts._expand_tar()`.
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
    # Extract to a scratch directory and rename, so an interrupted run never
    # leaves a half-populated dest that later runs would trust.
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

#' Is this a local path rather than something to download?
#'
#' Members extracted out of a tar carry their on-disk path where a remote file
#' carries a URL, so both fetching and path resolution have to tell them apart.
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
