#' Everything reachable from one accession
#'
#' Takes any accession (series, study, experiment, sample or run) and resolves
#' the rest itself. Each field makes its request the first time it is read and
#' keeps the answer, so reading one twice costs a single request and a field you
#' never touch costs nothing.
#'
#' The fields are:
#'
#' \describe{
#'   \item{`meta`}{the project record: title, summary, design, dates, files}
#'   \item{`samples`}{one record per sample}
#'   \item{`experiments`}{one record per library preparation}
#'   \item{`runs`}{one record per sequencing run, with its file URLs}
#'   \item{`supplementary`}{one row per supplementary file, series and sample
#'     alike; `sample` is `NA` on the ones the series carries itself}
#'   \item{`bams`}{the alignment files a submitter sent, where there are any}
#'   \item{`pubs`}{the publications linked to the dataset}
#'   \item{`links`}{the same data in other archives}
#'   \item{`enriched`}{the harmonised data for the samples: the submitter's free
#'     text read into one vocabulary, with ontology IDs}
#'   \item{`detail`}{the record for the accession itself, for a sample or run}
#' }
#'
#' and four that say where the data sits: `kind`, `project`, `geo`, `sra`.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession Any accession SeqOut holds.
#'
#' @return A `seqout_dataset` object. Read fields with `$`.
#'
#' @export
#' @examples
#' \dontrun{
#' d <- SeqoutGet("GSE168652")
#' d$meta$title
#' nrow(d$samples)
#' nrow(d$runs)
#' }
seqout_get <- function(accession, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  accession <- trimws(accession)
  kind <- accession_kind(accession)
  if (is.na(kind)) {
    shapes <- .sq_shapes
    cli::cli_abort(c(
      "{.val {accession}} is not an accession this library recognizes.",
      "i" = "Expected one of: {shapes}",
      "i" = "To search for it as text instead, use {.fn seqout_search}."
    ))
  }

  cache <- new.env(parent = emptyenv())
  structure(
    list(con = con, accession = accession, kind = kind, cache = cache),
    class = "seqout_dataset"
  )
}

#' @export
print.seqout_dataset <- function(x, ...) {
  filled <- ls(x$cache)
  cli::cli_inform(c(
    "{.cls seqout_dataset}",
    " " = "Accession: {x$accession}",
    " " = "Kind:      {x$kind}",
    " " = "Fetched:   {if (length(filled)) paste(sort(filled), collapse = ', ') else 'nothing yet'}"
  ))
  invisible(x)
}

#' @export
`$.seqout_dataset` <- function(x, name) {
  fields <- unclass(x)
  if (name %in% names(fields)) {
    return(fields[[name]])
  }
  if (!name %in% .dataset_fields) {
    fields <- .dataset_fields
    cli::cli_abort(c(
      "{.val {name}} is not a field of a {.cls seqout_dataset}.",
      "i" = "Available: {.val {fields}}"
    ))
  }
  if (!exists(name, envir = fields$cache, inherits = FALSE)) {
    assign(name, .dataset_fetch(x, name), envir = fields$cache)
  }
  base::get(name, envir = fields$cache, inherits = FALSE)
}

#' @export
names.seqout_dataset <- function(x) {
  c(names(unclass(x)), .dataset_fields)
}

#' @noRd
.dataset_fields <- c(
  "project", "sra", "geo", "meta", "samples", "experiments",
  "runs", "supplementary", "bams", "links", "enriched", "pubs", "detail"
)

#' @noRd
.dataset_fetch <- function(x, name) {
  fields <- unclass(x)
  con <- fields$con
  switch(name,
    project = .dataset_project(x),
    sra = .dataset_sra(x),
    geo = .dataset_geo(x),
    meta = project(x$project, con = con),
    samples = .dataset_samples(x),
    experiments = .dataset_experiments(x),
    runs = .dataset_runs(x),
    supplementary = .dataset_supplementary(x),
    bams = .dataset_bams(x),
    links = project_xref(x$project, con = con),
    enriched = project_enriched(x$project, con = con),
    pubs = publications(x$project, con = con),
    detail = .dataset_detail(x)
  )
}

#' The study or series a BioProject accession stands for
#'
#' A PRJ accession names the project, not the record: the archive files that
#' under its own accession, and which one depends on the archive (PRJCA to a
#' GSA CRA, PRJNA to a GEO series or an SRA study). `/prj/` answers the mapping
#' in one request; it is what the website resolves through.
#' @noRd
.prj_study <- function(con, accession) {
  if (!grepl("^PRJ", accession, ignore.case = TRUE) ||
    !identical(con$backend, "api")) {
    return(accession)
  }
  found <- tryCatch(
    .api_get(con, paste0("/prj/", accession))$project_accession,
    error = function(e) NULL
  )
  found %||% accession
}

#' @noRd
.dataset_project <- function(x) {
  fields <- unclass(x)
  if (fields$kind %in% .root_entities) {
    return(.prj_study(fields$con, fields$accession))
  }
  found <- if (startsWith(toupper(fields$accession), "GSM")) {
    gsm_series(fields$accession, con = fields$con)
  } else {
    resolve_study(fields$accession, con = fields$con)
  }
  if (!is.na(found) && nzchar(found)) {
    return(found)
  }
  cli::cli_abort(c(
    "Could not find the study that {fields$accession} (a {fields$kind}) belongs to.",
    "x" = "The archive serves no parent for it and it is not in the search index.",
    "i" = "Start from the study or series accession, or search for it with {.fn seqout_search}."
  ))
}

#' @noRd
.dataset_sra <- function(x) {
  project <- x$project
  if (.in_archive(project, .study_archives)) {
    return(project)
  }
  linked_study(project, con = unclass(x)$con)
}

#' @noRd
.dataset_geo <- function(x) {
  project <- x$project
  if (.in_archive(project, .geo_archives)) {
    return(project)
  }
  linked_geo(project, con = unclass(x)$con)
}

#' @noRd
.samples_of <- function(con, accession) {
  if (.in_archive(accession, .geo_archives)) {
    project_samples(accession, con = con)
  } else {
    .study_samples(con, accession)
  }
}

#' The sample records of a study the SRA family files
#'
#' `/project/{acc}/samples` answers with an accession, a title and a species,
#' and each sample's attributes are a further request away. The merged metadata
#' rows carry both, with the attributes already unnested into
#' `sample_attribute:` columns, for one request per five hundred runs. A study
#' files many runs against one sample, so the rows reduce to one per sample.
#' @noRd
.study_samples <- function(con, accession) {
  if (!identical(con$backend, "api")) {
    return(project_samples(accession, con = con))
  }
  rows <- tryCatch(.metadata_rows(con, accession), error = function(e) list())
  tbl <- .records_to_tibble(rows)
  if (!"sample_accession" %in% names(tbl)) {
    return(tryCatch(project_samples(accession, con = con), error = function(e) tibble::tibble()))
  }
  keep <- grepl("^sample_", names(tbl)) | names(tbl) %in% c("scientific_name", "taxon_id")
  out <- tbl[!duplicated(tbl$sample_accession), keep, drop = FALSE]
  names(out) <- sub("^sample_attribute:", "", names(out))
  names(out) <- sub("^sample_accession$", "accession", names(out))
  names(out) <- sub("^sample_(alias|description|title)$", "\\1", names(out))
  names(out) <- make.unique(names(out))
  tibble::as_tibble(out)
}

#' Every merged metadata row of a study, a page at a time
#'
#' `cursor` is an offset the endpoint echoes back rather than advances, so the
#' caller counts. `truncated` says whether more remain.
#' @noRd
.metadata_rows <- function(con, accession) {
  out <- list()
  cursor <- 0L
  repeat {
    res <- .api_get(
      con, paste0("/project/", accession, "/metadata/rows"),
      limit = 500, cursor = cursor
    )
    rows <- .as_record_list(res$rows)
    out <- c(out, rows)
    if (!isTRUE(res$truncated) || length(rows) == 0) {
      break
    }
    cursor <- cursor + length(rows)
  }
  out
}

#' @noRd
.dataset_samples <- function(x) {
  con <- unclass(x)$con
  native <- .samples_of(con, x$project)
  if (nrow(native) > 0) {
    return(.unnest_characteristics(native))
  }
  other <- if (identical(x$sra, x$project)) x$geo else x$sra
  if (!is.null(other) && !is.na(other) && !identical(other, x$project)) {
    return(.unnest_characteristics(.samples_of(con, other)))
  }
  native
}

#' Does this accession carry its own detail envelope?
#'
#' A sample, experiment or biosample reaches its experiment and its runs
#' through the detail endpoint, which asks for no study. Resolving one would
#' be a second request, and GEO does not always serve a parent for a GSM.
#' @noRd
.has_detail_envelope <- function(fields) {
  fields$kind %in% c("sample", "experiment", "biosample") &&
    identical(fields$con$backend, "api")
}

#' @noRd
.dataset_experiments <- function(x) {
  fields <- unclass(x)
  if (.has_detail_envelope(fields)) {
    return(.detail_part(fields$con, fields$accession, "experiment"))
  }
  study <- x$sra
  if (is.null(study) || is.na(study)) {
    return(tibble::tibble())
  }
  project_experiments(study, con = fields$con)
}

#' @noRd
.dataset_runs <- function(x) {
  fields <- unclass(x)
  if (identical(fields$kind, "run")) {
    return(run(fields$accession, con = fields$con))
  }
  if (.has_detail_envelope(fields)) {
    return(.detail_part(fields$con, fields$accession, "runs"))
  }
  study <- x$sra
  if (is.null(study) || is.na(study)) {
    return(tibble::tibble())
  }
  project_runs(study, full = TRUE, con = fields$con)
}

#' Flatten one `supplementary_data` cell into url / type rows
#'
#' GEO files each entry as a record carrying `#text` and `@type`. The Parquet
#' dump holds the same JSON as a string, which keeps no type.
#' @noRd
.supp_rows <- function(raw, sample) {
  pairs <- if (is.character(raw)) {
    lapply(unlist(.urls_in_json(raw), use.names = FALSE), function(u) {
      c(u, NA_character_)
    })
  } else {
    lapply(raw, function(f) {
      if (is.character(f)) {
        c(f[1], NA_character_)
      } else {
        c(f[["#text"]] %||% f[["url"]] %||% NA_character_, f[["@type"]] %||% NA_character_)
      }
    })
  }
  # GEO writes a literal "NONE" for a sample that carries no files.
  pairs <- Filter(function(p) !is.na(p[1]) && grepl("://", p[1], fixed = TRUE), pairs)
  if (length(pairs) == 0) {
    return(NULL)
  }
  url <- vapply(pairs, function(p) as.character(p[1]), character(1))
  tibble::tibble(
    sample = sample,
    file = basename(url),
    type = vapply(pairs, function(p) as.character(p[2]), character(1)),
    url = url
  )
}

#' @noRd
.dataset_supplementary <- function(x) {
  fields <- unclass(x)
  # A sample carries its own files. Reading them through the series would ask
  # for a parent the archive does not always serve, and would answer with the
  # whole series when only this accession was named.
  if (identical(fields$kind, "sample")) {
    detail <- x$detail
    if (!"supplementary_data" %in% names(detail)) {
      return(.supp_empty)
    }
    return(.supp_rows(detail$supplementary_data[[1]], fields$accession) %||% .supp_empty)
  }

  meta <- x$meta
  samples <- x$samples
  rows <- list()
  if ("supplementary_data" %in% names(meta)) {
    rows <- list(.supp_rows(meta$supplementary_data[[1]], NA_character_))
  }
  if (all(c("supplementary_data", "accession") %in% names(samples))) {
    rows <- c(rows, lapply(seq_len(nrow(samples)), function(i) {
      .supp_rows(samples$supplementary_data[[i]], samples$accession[i])
    }))
  }
  rows <- Filter(Negate(is.null), rows)
  if (length(rows) == 0) {
    return(.supp_empty)
  }
  do.call(rbind, rows)
}

#' The alignment files a submitter sent, rather than the reads
#'
#' SRA keeps these apart from the read files: they are listed as `Original`
#' entries beside the copies it made itself, and the archive publishes them
#' under whatever the submitter called them. Aligned to a reference the
#' submitter chose, so they are the paper's alignment rather than one of yours.
#' The endpoint answers for a study accession, which is what `$sra` resolves to.
#' @noRd
.dataset_bams <- function(x) {
  fields <- unclass(x)
  study <- tryCatch(x$sra, error = function(e) NULL)
  if (is.null(study) || is.na(study)) {
    return(.bams_empty)
  }
  res <- tryCatch(
    .api_get(fields$con, paste0("/project/", study, "/bams")),
    error = function(e) NULL
  )
  rows <- .as_record_list(res$bams)
  if (length(rows) == 0) {
    return(.bams_empty)
  }
  .records_to_tibble(rows)
}

#' @noRd
.bams_empty <- tibble::tibble(
  run_accession = character(0), experiment_accession = character(0),
  filename = character(0), url = character(0), size = character(0),
  md5 = character(0), semantic_name = character(0),
  https_url = character(0), s3_url = character(0)
)

#' @noRd
.supp_empty <- tibble::tibble(
  sample = character(0), file = character(0),
  type = character(0), url = character(0)
)

#' @noRd
.dataset_detail <- function(x) {
  fields <- unclass(x)
  if (fields$kind %in% .root_entities) {
    return(NULL)
  }
  if (identical(fields$kind, "run")) {
    return(run(fields$accession, con = fields$con))
  }
  if (fields$kind %in% c("sample", "experiment", "biosample")) {
    # The record reads the same way a row of $samples does: one column per
    # attribute, whether the archive filed them as GEO channels or as a
    # named attributes_json.
    return(.unnest_characteristics(sample_detail(fields$accession, con = fields$con)))
  }
  cli::cli_abort(c(
    "There is no detail record for {fields$accession} (a {fields$kind}).",
    "i" = "Use {.code $meta} for the project it resolves to, or {.code $samples} / {.code $runs} for its contents."
  ))
}
