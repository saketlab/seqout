#' Read a GEO accession as a counts matrix
#'
#' Resolves the supplementary files of a series or sample and groups them into
#' readable units, downloading nothing. GEO payloads run to tens of gigabytes,
#' so the manifest comes first and costs only the calls that list the files.
#'
#' A unit is a group of files that read as one matrix: a 10x triplet
#' (`matrix.mtx` with `barcodes.tsv` and `features.tsv`), a CellRanger `.h5`, an
#' `.h5ad`, an `.rds`, or a delimited table.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession A GSE or GSM accession.
#' @param assay Which assay to take when a sample carries several, as CITE-seq
#'   and multiome studies do. Defaults to `"rna"`; `"adt"`, `"hto"` and
#'   `"atac"` are recognised too. `NULL` takes whichever comes first.
#' @param feature_type 10x feature class to keep, overriding the one implied by
#'   `assay`. `NULL` keeps every row.
#' @param cache_dir Where downloads land. Defaults to a per-accession directory
#'   under [tools::R_user_dir()], reused across sessions.
#'
#' @return A `seqout_counts` handle. Pass it to [manifest()], [seqout_matrix()]
#'   or [matrices()].
#'
#' @export
#' @examples
#' \dontrun{
#' counts <- SeqoutCounts("GSE297547")
#' Manifest(counts)
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

  structure(
    list(
      con = con, accession = accession, assay = assay,
      feature_type = feature_type, cache_dir = cache_dir,
      cache = new.env(parent = emptyenv())
    ),
    class = "seqout_counts"
  )
}

#' @noRd
.assay_feature_type <- list(
  rna = "Gene Expression",
  adt = "Antibody Capture",
  hto = "Antibody Capture",
  atac = "Peaks"
)

#' @export
print.seqout_counts <- function(x, ...) {
  n <- if (exists("units", envir = x$cache, inherits = FALSE)) {
    length(base::get("units", envir = x$cache))
  } else {
    "?"
  }
  cli::cli_inform(c(
    "{.cls seqout_counts}",
    " " = "Accession: {x$accession}",
    " " = "Assay:     {x$assay %||% 'any'}",
    " " = "Units:     {n}"
  ))
  invisible(x)
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

#' What would be read, and from which files
#'
#' Shows every unit without downloading anything. `preferred` marks the unit
#' that [seqout_matrix()] picks for each sample; `has_metadata` says whether
#' per-cell annotation is available, as a sidecar file or embedded.
#'
#' @param counts A `seqout_counts` handle from [seqout_counts()].
#' @param preferred_only Show only the preferred unit per sample.
#'
#' @return A tibble, one row per unit.
#'
#' @export
manifest <- function(counts, preferred_only = FALSE) {
  .check_counts(counts)
  units <- .counts_units(counts, preferred_only = preferred_only)
  if (length(units) == 0) {
    return(tibble::tibble())
  }
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

#' The readable units behind the manifest
#'
#' @param counts A `seqout_counts` handle from [seqout_counts()].
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
#' @param counts A `seqout_counts` handle from [seqout_counts()].
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
#' @param counts A `seqout_counts` handle from [seqout_counts()].
#' @param sample A unit label or sample accession. Required when the accession
#'   holds more than one unit.
#'
#' @return A `seqout_matrix`: a list with `X` (observations by features), `obs`,
#'   `var`, `kind`, `fmt` and `evidence`.
#'
#' @export
seqout_matrix <- function(counts, sample = NULL) {
  .check_counts(counts)
  unit <- .select_unit(counts, sample)
  .read_unit(counts, unit)
}

#' Counts in either orientation
#'
#' `counts_matrix()`, aliased `genexcell_counts()`, gives features by
#' observations; `cellxgene_counts()` the reverse.
#'
#' @param x A `seqout_matrix` from [seqout_matrix()] or [matrices()].
#'
#' @return A matrix, dgCMatrix if `x$X` was sparse.
#'
#' @seealso [bind_counts()] to combine several samples into one matrix.
#'
#' @examples
#' \dontrun{
#' counts <- SeqoutCounts("GSE291735")
#' CountsMatrix(SeqoutMatrix(counts, sample = "GSM8994520"))
#' }
#'
#' @export
counts_matrix <- function(x) {
  .transpose(.counts_X(x))
}

#' @rdname counts_matrix
#' @export
genexcell_counts <- counts_matrix

#' @rdname counts_matrix
#' @export
cellxgene_counts <- function(x) .counts_X(x)

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
  genes <- Reduce(intersect, lapply(Xs, colnames))
  if (length(genes) == 0) {
    cli::cli_abort("The {length(Xs)} matrices share no features.")
  }
  labels <- labels %||% names(x) %||% seq_along(x)

  out <- Map(function(X, label) {
    i <- if (!is.null(max_cells) && nrow(X) > max_cells) {
      sort(sample.int(nrow(X), max_cells))
    } else {
      seq_len(nrow(X))
    }
    X <- .transpose(X[i, genes, drop = FALSE])
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
#' not fail the whole call. Compare the length against [manifest()].
#'
#' @param counts A `seqout_counts` handle from [seqout_counts()].
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
        "i" = "Pass {.arg sample}, or use {.fn matrices}. See {.fn manifest}."
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
    cli::cli_abort("No unit for {.val {sample}}; see {.fn manifest}.")
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

#' @noRd
.fetch_unit <- function(counts, unit) {
  .download_files(.unit_urls(unit), counts$cache_dir)
}

#' @noRd
.read_unit <- function(counts, unit) {
  .fetch_unit(counts, unit)
  file_roles <- vapply(unit$files, function(f) f$role, character(1))
  file_urls <- vapply(unit$files, function(f) f$url, character(1))
  file_names <- vapply(unit$files, function(f) f$name, character(1))
  first_role <- !duplicated(file_roles)
  by_role <- as.list(file.path(counts$cache_dir, basename(file_urls[first_role])))
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

  dimnames(parsed$X) <- list(rownames(parsed$obs), rownames(parsed$var))

  structure(
    list(
      X = parsed$X, obs = parsed$obs, var = parsed$var,
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
    " " = "{x$accession}: {nrow(x$X)} {label} x {ncol(x$X)} genes",
    " " = "Kind:   {x$kind}",
    " " = "Format: {x$fmt}",
    " " = "Source: {x$source}"
  ))
  invisible(x)
}
