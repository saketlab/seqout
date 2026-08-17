#' Fetch a list of URLs into a directory
#'
#' Skips any file already present. Downloads run in parallel through curl's
#' multi interface.
#'
#' @param urls Character vector of URLs.
#' @param dest_dir Directory to write into. Created when missing.
#' @param overwrite Re-download files that are already present.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the files in `dest_dir`, invisibly.
#' @noRd
.download_files <- function(urls, dest_dir, overwrite = FALSE, quiet = FALSE) {
  rlang::check_required(urls)
  rlang::check_required(dest_dir)
  urls <- unique(urls[!is.na(urls) & nzchar(urls)])
  if (length(urls) == 0) {
    return(invisible(character(0)))
  }
  dir.create(dest_dir, recursive = TRUE, showWarnings = FALSE)

  paths <- .dest_paths(urls, dest_dir)
  missing <- if (overwrite) rep(TRUE, length(urls)) else !file.exists(paths)

  if (any(missing)) {
    if (!quiet) {
      cli::cli_alert_info("Downloading {sum(missing)} file{?s} to {.path {dest_dir}}")
    }
    .curl_download(urls[missing], paths[missing], quiet = quiet)
  }
  invisible(paths)
}

#' Map urls to destination paths, keeping the names distinct
#'
#' Per-sample CellRanger output ends in the same three filenames for every
#' sample, so the basename alone collides: the second file would be taken for
#' one already downloaded and silently skipped. Names that collide take parent
#' path segments until they separate; names that do not stay short.
#' @noRd
.dest_paths <- function(urls, dest_dir) {
  parts <- strsplit(sub("^[a-z]+://", "", urls), "/", fixed = TRUE)
  out <- vapply(parts, function(p) p[length(p)], character(1))
  depth <- 1L
  while (depth < max(lengths(parts))) {
    dup <- duplicated(out) | duplicated(out, fromLast = TRUE)
    if (!any(dup)) {
      break
    }
    depth <- depth + 1L
    out[dup] <- vapply(parts[dup], function(p) {
      paste(utils::tail(p, depth), collapse = "_")
    }, character(1))
  }
  file.path(dest_dir, out)
}

#' Fetch urls to paths, retrying ftp:// over https
#'
#' NCBI serves the same paths both ways. Networks that block outbound port 21
#' are common enough that an ftp:// failure is not the end of the attempt.
#' @noRd
.curl_download <- function(urls, paths, quiet = FALSE) {
  parts <- paste0(paths, ".part")
  res <- curl::multi_download(urls, parts, resume = TRUE, progress = !quiet)
  reason <- .download_reason(res)

  retry <- !is.na(reason) & startsWith(urls, "ftp://")
  if (any(retry)) {
    if (!quiet) {
      cli::cli_alert_info("FTP unavailable, retrying {sum(retry)} file{?s} over HTTPS")
    }
    unlink(parts[retry])
    over_https <- sub("^ftp://", "https://", urls[retry])
    again <- curl::multi_download(
      over_https, parts[retry],
      resume = FALSE, progress = !quiet
    )
    reason[retry] <- .download_reason(again)
  }

  # A file takes its real name only once it is whole, so a half-written one is
  # never taken for finished on the next call. What is left behind resumes,
  # unless the server answered with an error page: appending to that would
  # produce a file that is neither the error nor the data.
  ok <- is.na(reason)
  file.rename(parts[ok], paths[ok])
  unlink(parts[!ok][startsWith(reason[!ok], "HTTP ")])

  if (any(!ok)) {
    cli::cli_abort(c(
      "Download failed for {sum(!ok)} of {length(urls)} file{?s}.",
      "x" = "{basename(paths[!ok])[1]}: {reason[!ok][1]}",
      "i" = if (any(ok)) {
        "{sum(ok)} file{?s} finished; running again retries only the rest."
      } else {
        "Running again resumes where this stopped."
      }
    ))
  }
  invisible(paths)
}

#' Why each download failed, `NA` where it did not
#'
#' curl reports a network failure in `error`, but an HTTP error status is a
#' request that completed: what lands on disk is the server's error page under
#' the name of the file that was asked for. Both have to count as failures.
#' @noRd
.download_reason <- function(res) {
  reason <- res$error
  status <- res$status_code
  if (is.null(status)) {
    return(reason)
  }
  bad <- is.na(reason) & !is.na(status) & status >= 400
  reason[bad] <- paste("HTTP", status[bad])
  reason
}

#' Download the supplementary files of an accession
#'
#' The processed files a submitter uploaded: count matrices, annotations and
#' archives. A series or study downloads its own files and every sample's; a GEO
#' sample downloads only its own. An experiment, run or BioSample carries no
#' files of its own, so it names the project to ask for rather than widening to
#' the whole study.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession Any accession SeqOut holds.
#' @param dest_dir Directory to write into. Defaults to the accession.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' download_supplementary("GSE168652") # series files and every sample's
#' download_supplementary("GSM8433846") # that one sample's
#' download_supplementary("E-MTAB-11467") # processed archives and raw
#' }
download_supplementary <- function(accession, dest_dir = NULL, quiet = FALSE, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  accession <- trimws(accession)
  kind <- accession_kind(accession)
  if (is.na(kind)) {
    shapes <- .sq_shapes
    cli::cli_abort(c(
      "{.val {accession}} is not an accession this library recognizes.",
      "i" = "Expected one of: {shapes}"
    ))
  }
  # An experiment, run or BioSample carries no files of its own. Widening to its
  # project would write the whole study to disk under the name of one record.
  if (!kind %in% c(.root_entities, "sample")) {
    project <- tryCatch(seqout_get(accession, con = con)$project, error = function(e) NULL)
    cli::cli_abort(c(
      "{accession} is a {kind}; supplementary files belong to its project.",
      "i" = if (!is.null(project)) {
        "Ask for that instead: {.code download_supplementary(\"{project}\")}"
      }
    ))
  }
  if (is.null(dest_dir)) dest_dir <- accession

  urls <- .supplementary_for(con, accession)
  if (length(urls) == 0) {
    cli::cli_alert_warning("{accession} lists no supplementary files.")
    return(invisible(character(0)))
  }
  .download_files(urls, dest_dir, quiet = quiet)
}

#' Every supplementary URL an accession reaches
#'
#' A sample owns its files. A series or study owns two sets, and which is where
#' depends on the archive: GEO keeps the series-level ones
#' on the series and the rest on each sample, ArrayExpress keeps processed
#' archives on the experiment and raw ones on the samples. `/supplementary`
#' answers the project level for both, so it is the only path that sees the
#' ArrayExpress processed archives; the dataset field adds GEO's per-sample
#' files. An SRA, ENA, DDBJ or GSA study holds none of its own and reaches them
#' through the GEO or ArrayExpress twins the submitter also deposited to. Every
#' twin is read, not the first: a study split across two series carries a
#' different half of its files on each.
#' @noRd
.supplementary_for <- function(con, accession) {
  d <- seqout_get(accession, con = con)
  if (identical(d$kind, "sample")) {
    return(d$supplementary$url)
  }

  project <- d$project
  targets <- if (.in_archive(project, .geo_archives)) {
    project
  } else {
    .geo_twins(con, project)
  }
  urls <- lapply(targets, function(target) {
    own <- if (identical(target, project)) d else seqout_get(target, con = con)
    c(.supp_endpoint_urls(con, target), own$supplementary$url)
  })
  unique(unlist(urls, use.names = FALSE))
}

#' Every GEO or ArrayExpress accession cross-referenced from a project
#'
#' [linked_geo()] answers with one, which is what resolving a study to a series
#' wants. Files are additive, so here they all count.
#' @noRd
.geo_twins <- function(con, accession) {
  xref <- tryCatch(project_xref(accession, con = con), error = function(e) NULL)
  if (is.null(xref) || nrow(xref) == 0 || !"accession" %in% names(xref)) {
    return(character(0))
  }
  hits <- xref$accession[vapply(xref$accession, .in_archive, logical(1), .geo_archives)]
  unique(hits)
}

#' Project-level supplementary URLs, straight from the endpoint
#'
#' Answers for GEO, ArrayExpress and GEA only; anything else 404s, so the call
#' is skipped rather than made and discarded.
#' @noRd
.supp_endpoint_urls <- function(con, accession) {
  if (!identical(con$backend, "api") || !.in_archive(accession, .geo_archives)) {
    return(character(0))
  }
  res <- tryCatch(
    .api_get(con, paste0("/project/", accession, "/supplementary")),
    error = function(e) NULL
  )
  urls <- vapply(
    res$files %||% list(),
    function(f) f$url %||% NA_character_,
    character(1)
  )
  unname(urls[!is.na(urls)])
}

#' Download the read files of a study
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param study A study accession.
#' @param dest_dir Directory to write into. Defaults to the study accession.
#' @param mode Which copy to take. Not every run offers every mode.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files.
#'
#' @export
download_runs <- function(study, dest_dir = NULL,
                          mode = names(.run_url_columns),
                          quiet = FALSE,
                          con = .con()) {
  .check_connection(con)
  rlang::check_required(study)
  mode <- match.arg(mode)
  if (is.null(dest_dir)) dest_dir <- study

  runs <- project_runs(study, full = TRUE, con = con)
  if (nrow(runs) == 0) {
    cli::cli_alert_warning("{study} has no runs.")
    return(invisible(character(0)))
  }
  column <- .run_url_columns[[mode]]
  if (!column %in% names(runs)) {
    cli::cli_abort(c(
      "The runs of {study} carry no {.val {mode}} URLs.",
      "i" = "Available: {.val {intersect(names(runs), unlist(.run_url_columns))}}"
    ))
  }
  values <- runs[[column]]
  values <- values[!is.na(values) & nzchar(values)]
  urls <- unlist(strsplit(values, ";", fixed = TRUE))
  .download_files(urls, dest_dir, quiet = quiet)
}

#' @noRd
.run_url_columns <- list(
  fastq = "fastq_ftp", sra = "sra_ftp", sra_lite = "ncbi_sra_lite_url",
  s3 = "ncbi_sra_lite_s3_url", gcs = "ncbi_sra_lite_gs_url"
)

#' Get a download script for a study
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param study A study accession.
#' @param mode Download source.
#' @param file Optional path to write the script to.
#'
#' @return The script as a character string, invisibly when `file` is given.
#'
#' @export
download_script <- function(study, mode = "fastq", file = NULL, con = .con()) {
  .check_connection(con)
  rlang::check_required(study)
  mode <- match.arg(mode, names(.run_url_columns))

  result <- .api_get_text(con, paste0("/project/", study, "/download/", mode))

  if (!is.null(file)) {
    writeLines(result, file)
    Sys.chmod(file, "0755")
    cli::cli_alert_success("Wrote download script to {.path {file}}")
    return(invisible(result))
  }
  result
}
