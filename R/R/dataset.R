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
#'   \item{`pubs`}{the publications linked to the dataset}
#'   \item{`links`}{the same data in other archives}
#'   \item{`enriched`}{structured labels for the samples, where SeqOut has them}
#'   \item{`detail`}{the record for the accession itself, for a sample or run}
#' }
#'
#' and four that say where the data sits: `kind`, `project`, `geo`, `sra`.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession Any accession SeqOut holds.
#'
#' @return A `seqout_dataset` object. Read fields with `$`.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' d <- dataset(con, "GSE168652")
#' d$meta$title
#' nrow(d$samples)
#' nrow(d$runs)
#' }
dataset <- function(con, accession) {
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
  get(name, envir = fields$cache, inherits = FALSE)
}

#' @export
names.seqout_dataset <- function(x) {
  c(names(unclass(x)), .dataset_fields)
}

#' @noRd
.dataset_fields <- c(
  "project", "sra", "geo", "meta", "samples", "experiments",
  "runs", "links", "enriched", "pubs", "detail"
)

#' @noRd
.dataset_fetch <- function(x, name) {
  fields <- unclass(x)
  con <- fields$con
  switch(name,
    project = .dataset_project(x),
    sra = .dataset_sra(x),
    geo = .dataset_geo(x),
    meta = project_metadata(con, x$project),
    samples = .dataset_samples(x),
    experiments = .dataset_experiments(x),
    runs = .dataset_runs(x),
    links = project_xref(con, x$project),
    enriched = project_enriched(con, x$project),
    pubs = publications(con, x$project),
    detail = .dataset_detail(x)
  )
}

#' @noRd
.dataset_project <- function(x) {
  fields <- unclass(x)
  if (fields$kind %in% .root_entities) {
    return(fields$accession)
  }
  found <- if (startsWith(toupper(fields$accession), "GSM")) {
    gsm_series(fields$con, fields$accession)
  } else {
    resolve_study(fields$con, fields$accession)
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
  linked_study(unclass(x)$con, project)
}

#' @noRd
.dataset_geo <- function(x) {
  project <- x$project
  if (.in_archive(project, .geo_archives)) {
    return(project)
  }
  linked_geo(unclass(x)$con, project)
}

#' @noRd
.samples_of <- function(con, accession) {
  if (.in_archive(accession, .geo_archives)) {
    project_samples(con, accession)
  } else {
    project_experiments(con, accession)
  }
}

#' @noRd
.dataset_samples <- function(x) {
  con <- unclass(x)$con
  native <- .samples_of(con, x$project)
  if (nrow(native) > 0) {
    return(native)
  }
  other <- if (identical(x$sra, x$project)) x$geo else x$sra
  if (!is.null(other) && !is.na(other) && !identical(other, x$project)) {
    return(.samples_of(con, other))
  }
  native
}

#' @noRd
.dataset_experiments <- function(x) {
  study <- x$sra
  if (is.null(study) || is.na(study)) {
    return(tibble::tibble())
  }
  project_experiments(unclass(x)$con, study)
}

#' @noRd
.dataset_runs <- function(x) {
  study <- x$sra
  if (is.null(study) || is.na(study)) {
    return(tibble::tibble())
  }
  project_runs(unclass(x)$con, study)
}

#' @noRd
.dataset_detail <- function(x) {
  fields <- unclass(x)
  if (fields$kind %in% .root_entities) {
    return(NULL)
  }
  if (identical(fields$kind, "run")) {
    return(run(fields$con, fields$accession))
  }
  if (fields$kind %in% c("sample", "experiment", "biosample")) {
    return(sample_detail(fields$con, fields$accession))
  }
  cli::cli_abort(c(
    "There is no detail record for {fields$accession} (a {fields$kind}).",
    "i" = "Use {.code $meta} for the project it resolves to, or {.code $samples} / {.code $runs} for its contents."
  ))
}
