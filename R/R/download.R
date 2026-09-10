#' Fetch a list of URLs into a directory
#'
#' Existing files are skipped. curl fetches missing files in parallel.
#'
#' @param urls Character vector of URLs.
#' @param dest_dir Directory to write into. Created when missing.
#' @param overwrite Re-download files that are already present.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the files in `dest_dir`, invisibly.
#' @noRd
.download_files <- function(urls, dest_dir, names = NULL, md5 = NULL,
                            overwrite = FALSE, quiet = FALSE) {
  rlang::check_required(urls)
  rlang::check_required(dest_dir)
  keep <- !is.na(urls) & nzchar(urls) & !duplicated(urls)
  urls <- urls[keep]
  names <- names[keep]
  md5 <- md5[keep]
  if (length(urls) == 0) {
    return(invisible(character(0)))
  }
  dir.create(dest_dir, recursive = TRUE, showWarnings = FALSE)

  paths <- if (is.null(names)) .dest_paths(urls, dest_dir) else file.path(dest_dir, names)
  missing <- if (overwrite) rep(TRUE, length(urls)) else !file.exists(paths)

  if (any(missing)) {
    if (!quiet) {
      cli::cli_alert_info("Downloading {sum(missing)} file{?s} to {.path {dest_dir}}")
    }
    .curl_download(urls[missing], paths[missing], md5 = md5[missing], quiet = quiet)
  }
  invisible(paths)
}

#' Map urls to destination paths, keeping the names distinct
#'
#' Duplicate basenames take parent path segments, preventing false cache hits.
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

#' Fetch URLs to paths, retrying ftp:// over HTTPS
#'
#' NCBI serves the same paths over both schemes; blocked FTP can still succeed.
#' @noRd
.curl_download <- function(urls, paths, md5 = NULL, quiet = FALSE) {
  urls <- .with_scheme(urls)
  parts <- paste0(paths, ".part")
  reason <- .fetch_batched(urls, parts, resume = TRUE, quiet = quiet)

  retry <- !is.na(reason) & startsWith(urls, "ftp://")
  if (any(retry)) {
    if (!quiet) {
      cli::cli_alert_info("FTP unavailable, retrying {sum(retry)} file{?s} over HTTPS")
    }
    unlink(parts[retry])
    # Retries reuse the URL that succeeded.
    urls[retry] <- sub("^ftp://", "https://", urls[retry])
    reason[retry] <- .fetch_batched(urls[retry], parts[retry], resume = FALSE, quiet = quiet)
  }

  # throttled connect failures can succeed after a pause
  for (attempt in seq_len(2)) {
    again <- which(!is.na(reason) & !startsWith(reason, "HTTP "))
    if (length(again) == 0) {
      break
    }
    if (!quiet) {
      cli::cli_alert_info("Retrying {length(again)} file{?s} the archive did not serve")
    }
    .retry_pause(attempt)
    reason[again] <- .fetch_batched(urls[again], parts[again], resume = TRUE, quiet = quiet)
  }

  # Rename completed downloads to prevent partial-file cache hits.
  ok <- is.na(reason)
  # a 200 body can be short and say nothing; the published checksum decides
  if (!is.null(md5) && any(ok)) {
    at <- which(ok)
    want <- tolower(md5[at])
    got <- unname(tools::md5sum(parts[at]))
    bad <- !is.na(want) & nzchar(want) & !is.na(got) & got != want
    reason[at[bad]] <- "checksum mismatch"
    ok <- is.na(reason)
  }
  file.rename(parts[ok], paths[ok])
  # never resume into an error page or a corrupt body
  unlink(parts[!ok][grepl("^(HTTP |checksum)", reason[!ok])])

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

#' Fetch in groups to bound queued work
#'
#' Batch transfers to bound curl handles and avoid queue refusals.
#' @noRd
.fetch_batched <- function(urls, paths, resume, quiet) {
  reason <- rep(NA_character_, length(urls))
  groups <- split(seq_along(urls), ceiling(seq_along(urls) / .download_batch))
  for (at in groups) {
    res <- curl::multi_download(
      urls[at], paths[at],
      resume = resume, progress = !quiet, connecttimeout = .connect_timeout
    )
    reason[at] <- .download_reason(res)
  }
  reason
}

#' Wait before asking a throttled archive again
#' @noRd
.retry_pause <- function(attempt) Sys.sleep(2 * attempt)

#' @noRd
.download_batch <- 50L

#' How long to wait for a throttled archive to accept a connection
#'
#' Longer waits keep queued transfers from failing early.
#' @noRd
.connect_timeout <- 60L

#' Give a bare host/path an explicit scheme
#'
#' Bare ENA `fastq_ftp` paths make curl choose FTP and skip HTTPS retry.
#' Prefix HTTPS so range requests and resume work.
#' @noRd
.with_scheme <- function(urls) {
  bare <- !grepl("^[a-z][a-z0-9+.-]*://", urls, ignore.case = TRUE)
  urls[bare] <- paste0("https://", urls[bare])
  urls
}

#' Why each download failed, `NA` where it did not
#'
#' HTTP errors write error pages to disk, so status codes must count as failures.
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

#' Download the Parquet dump
#'
#' Fetches `.parquet` files for the Parquet backend. Existing files are skipped.
#' HEAD sizes are reported before transfer when available.
#'
#' @param con A `seqout_connection`. Either backend works: the files are read
#'   from the same place both point at.
#' @param dest_dir Directory to write into. It is created if it is absent.
#' @param tables Which tables to fetch. The default, `NULL`, fetches all of
#'   them. See [tables()].
#' @param overwrite Fetch a file even when it is already on disk.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files, invisibly.
#'
#' @seealso [seqout_connect()] to read the result, and [cache_table()] to keep
#'   one table in local DuckDB storage.
#'
#' @export
#' @examples
#' \dontrun{
#' # two common tables
#' DownloadDump(dest_dir = "~/seqout-dump", tables = c("unified_metadata", "geo_series"))
#'
#' con <- SeqoutConnect("parquet", data_dir = "~/seqout-dump")
#' Query("SELECT count(*) FROM unified_metadata", con = con)
#' }
download_dump <- function(con = .con(), dest_dir = "seqout-dump", tables = NULL,
                          overwrite = FALSE, quiet = FALSE) {
  .check_connection(con)
  tables <- tables %||% con$tables
  unknown <- setdiff(tables, con$tables)
  if (length(unknown) > 0) {
    cli::cli_abort(c(
      "Not a Seqout table: {.val {unknown}}.",
      "i" = "See {.fn tables} for the names."
    ))
  }

  urls <- paste0(con$data_url, "/", tables, ".parquet")
  if (!quiet) {
    .report_dump_size(urls, tables)
  }
  .download_files(
    urls, dest_dir,
    names = paste0(tables, ".parquet"),
    overwrite = overwrite, quiet = quiet
  )
}

#' Report transfer size before download
#'
#' HEAD failures leave the download allowed.
#' @noRd
.report_dump_size <- function(urls, tables) {
  bytes <- vapply(urls, .remote_bytes, numeric(1), USE.NAMES = FALSE)
  total <- sum(bytes, na.rm = TRUE)
  if (total <= 0) {
    cli::cli_alert_info("Fetching {length(tables)} table{?s}.")
    return(invisible(NULL))
  }
  size <- .pretty_bytes(total)
  cli::cli_alert_info("Fetching {length(tables)} table{?s}, {size}.")
  invisible(NULL)
}

#' @noRd
.remote_bytes <- function(url) {
  head <- tryCatch(
    curl::curl_fetch_memory(url, curl::new_handle(nobody = TRUE, timeout = 30)),
    error = function(e) NULL
  )
  if (is.null(head) || head$status_code >= 400) {
    return(NA_real_)
  }
  n <- sub(
    ".*[Cc]ontent-[Ll]ength: *([0-9]+).*", "\\1",
    rawToChar(head$headers)
  )
  suppressWarnings(as.numeric(n))
}

#' Download the supplementary files of an accession
#'
#' Downloads processed files: matrices, annotations and archives.
#' Samples stay scoped to their own files.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession Any accession Seqout holds.
#' @param dest_dir Directory to write into. Defaults to the accession.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' DownloadSupplementary("GSE168652") # series files and every sample's
#' DownloadSupplementary("GSM8433846") # that one sample's
#' DownloadSupplementary("E-MTAB-11467") # processed archives and raw
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
  # widening to the project would write the whole study under one record's name
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
#' Combines project endpoint, sample files, and GEO or ArrayExpress twins.
#' All twins are additive because split studies carry different files.
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

#' GEO or ArrayExpress accessions cross-referenced from a project
#'
#' Files are additive, so keep every linked series.
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
#' Only GEO, ArrayExpress and GEA expose this endpoint.
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

#' Download the read files of an accession
#'
#' Runs download their own files; larger accessions download all resolved runs.
#' Default mode order is fastq, full SRA, then SRA lite.
#' Published checksums are verified.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession Any accession Seqout holds.
#' @param dest_dir Directory to write into. Defaults to the accession.
#' @param mode Which copy to take: `"fastq"`, `"sra"` (NCBI's full-quality
#'   copy) or `"sra_lite"` (the same reads with binned quality scores). `NULL`
#'   takes the first each run offers, in that order.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' DownloadRuns("SRR12012336") # one run
#' DownloadRuns("SRP267291") # every run of a study
#' DownloadRuns("SRP150719", mode = "fastq") # insist on ENA fastq
#' }
download_runs <- function(accession, dest_dir = NULL, mode = NULL,
                          quiet = FALSE, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  accession <- trimws(accession)
  if (!is.null(mode)) {
    if (mode %in% .run_paid_modes) {
      cli::cli_abort(c(
        "{.val {mode}} names the same reads in a requester-pays bucket, which curl cannot fetch.",
        "i" = "Use {.val sra} for the same copy over anonymous HTTPS."
      ))
    }
    mode <- match.arg(mode, names(.run_modes))
  }
  if (is.null(dest_dir)) dest_dir <- accession

  runs <- seqout_get(accession, con = con)$runs
  if (!is.data.frame(runs) || nrow(runs) == 0) {
    cli::cli_alert_warning("{accession} has no runs.")
    return(invisible(character(0)))
  }

  picked <- .pick_run_files(runs, mode %||% .run_auto_order)
  found <- !is.na(picked$source)
  if (!any(found)) {
    cli::cli_abort(c(
      "No run of {accession} is served as {.val {mode %||% 'any downloadable copy'}}.",
      "i" = "URL columns present: {.val {intersect(names(runs), unlist(.run_modes))}}"
    ))
  }

  .warn_run_choice(accession, runs, picked, mode, dest_dir, found)
  .download_files(
    unlist(picked$urls[found], use.names = FALSE),
    dest_dir,
    names = unlist(picked$names[found], use.names = FALSE),
    md5 = unlist(picked$md5[found], use.names = FALSE),
    quiet = quiet
  )
}

#' Warn when download mode is inferred or an accession resolves to a whole study
#' @noRd
.warn_run_choice <- function(accession, runs, picked, mode, dest_dir, found) {
  if (is.null(mode)) {
    counts <- table(picked$source[found])
    chosen <- paste0(counts, " from ", names(counts), collapse = ", ")
    cli::cli_warn(c(
      "No {.arg mode} given; taking the first copy each run offers.",
      "i" = "{chosen}."
    ))
  }
  kind <- accession_kind(accession)
  if (kind %in% .root_entities) {
    size <- .pretty_bytes(.run_bytes(runs, picked$column))
    scale <- paste0(sum(found), " run", if (sum(found) != 1) "s" else "")
    if (!is.na(size)) {
      scale <- paste0(scale, ", ", size)
    }
    one <- picked$ids[found][1]
    cli::cli_warn(c(
      "{accession} is a {kind}: this downloads all of it ({scale}) into {.path {dest_dir}}.",
      "i" = if (!is.na(one)) "For a single run, name it: {.code download_runs(\"{one}\")}."
    ))
  }
  if (any(!found)) {
    # cli quantity must use the same count on both branches
    cli::cli_warn(
      "{sum(!found)} of {length(found)} run{?s} {cli::qty(sum(!found))}{?has/have} no downloadable copy and {?is/are} skipped."
    )
  }
}

#' The three forms a run's reads come in, and where each is served
#'
#' Modes name read copies; columns under a mode name host choices, best first.
#' `ncbi_sra_url_aws` is anonymous and resumable.
#' @noRd
.run_modes <- list(
  fastq = "fastq_ftp",
  sra = c("ncbi_sra_url_aws", "ncbi_sra_normalized_url", "sra_ftp"),
  sra_lite = c("ncbi_sra_lite_url", "ncbi_sra_url")
)

#' Preference order when the caller names no mode
#'
#' Fastq needs no conversion; SRA lite has binned quality scores.
#' @noRd
.run_auto_order <- c("fastq", "sra", "sra_lite")

#' Requester-pays read modes
#'
#' `s3` and `gcs` bill the caller and cannot be fetched anonymously.
#' @noRd
.run_paid_modes <- c("s3", "gcs")

#' Checksums and sizes, by the column the URL came from
#'
#' Archive-owned copies publish checksums; NCBI SRA copies do not.
#' @noRd
.run_md5_of <- c(fastq_ftp = "fastq_md5", sra_ftp = "sra_md5")

#' @noRd
.run_bytes_of <- c(
  fastq_ftp = "fastq_bytes",
  sra_ftp = "sra_bytes",
  ncbi_sra_url_aws = "ncbi_sra_normalized_bytes",
  ncbi_sra_normalized_url = "ncbi_sra_normalized_bytes",
  ncbi_sra_lite_url = "ncbi_sra_lite_bytes",
  ncbi_sra_url = "ncbi_sra_lite_bytes"
)

#' The run accession of each row, whichever column carries it
#' @noRd
.run_ids <- function(runs) {
  for (column in c("run_accession", "accession", "run")) {
    if (column %in% names(runs)) {
      return(as.character(runs[[column]]))
    }
  }
  rep(NA_character_, nrow(runs))
}

#' Choose one source per run, in the given order of preference
#'
#' Runs with no downloadable copy keep `NA` so skips can be reported.
#' @noRd
.pick_run_files <- function(runs, modes) {
  ids <- .run_ids(runs)
  urls <- vector("list", nrow(runs))
  dest <- vector("list", nrow(runs))
  md5 <- vector("list", nrow(runs))
  source <- rep(NA_character_, nrow(runs))
  column <- rep(NA_character_, nrow(runs))

  for (mode in modes) {
    for (from in .run_modes[[mode]] %||% character(0)) {
      if (!from %in% names(runs)) {
        next
      }
      values <- as.character(runs[[from]])
      take <- which(is.na(source) & !is.na(values) & nzchar(values))
      for (i in take) {
        # a paired run packs both mates into one cell, checksums in the same order
        found <- unlist(strsplit(values[i], ";", fixed = TRUE))
        urls[[i]] <- found
        dest[[i]] <- .run_dest_names(ids[i], found, mode)
        md5[[i]] <- .run_md5(runs, i, from, length(found))
        source[i] <- mode
        column[i] <- from
      }
    }
  }
  list(ids = ids, urls = urls, names = dest, md5 = md5, source = source, column = column)
}

#' The published checksum of each file of one run, `NA` where there is none
#' @noRd
.run_md5 <- function(runs, i, from, n) {
  column <- unname(.run_md5_of[from])
  if (is.na(column) || !column %in% names(runs)) {
    return(rep(NA_character_, n))
  }
  found <- unlist(strsplit(as.character(runs[[column]][i]), ";", fixed = TRUE))
  # trust a checksum list only where it lines up with the URL list
  if (length(found) != n) {
    return(rep(NA_character_, n))
  }
  found
}

#' What each run file is called on disk
#'
#' ENA names already include run and mate suffixes. NCBI SRA copies need `.sra`.
#' @noRd
.run_dest_names <- function(id, urls, mode) {
  if (identical(mode, "fastq") || is.na(id)) {
    return(basename(urls))
  }
  if (length(urls) == 1) {
    return(paste0(id, ".sra"))
  }
  paste0(id, "_", seq_along(urls), ".sra")
}

#' Total bytes of the chosen copies, `NA` where the archive gives no size
#' @noRd
.run_bytes <- function(runs, column) {
  totals <- vapply(seq_along(column), function(i) {
    if (is.na(column[i])) {
      return(NA_real_)
    }
    from <- unname(.run_bytes_of[column[i]])
    if (is.na(from) || !from %in% names(runs)) {
      return(NA_real_)
    }
    parts <- strsplit(as.character(runs[[from]][i]), ";", fixed = TRUE)[[1]]
    sum(suppressWarnings(as.numeric(parts)), na.rm = TRUE)
  }, numeric(1))
  sum(totals, na.rm = TRUE)
}

#' @noRd
.pretty_bytes <- function(n) {
  if (!is.finite(n) || n <= 0) {
    return(NA_character_)
  }
  units <- c("B", "kB", "MB", "GB", "TB", "PB")
  i <- min(length(units), floor(log(n, 1000)) + 1)
  paste0(round(n / 1000^(i - 1), 1), " ", units[i])
}

#' Download the alignment files a submitter sent
#'
#' Fetches submitter BAMs aligned to their chosen reference.
#'
#' Requester-pays files are named with the command to fetch them.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession Any accession Seqout holds. Resolved to its study, since
#'   the archive files alignments against one.
#' @param dest_dir Directory to write into. Defaults to the accession.
#' @param quiet Suppress progress messages.
#'
#' @return The paths of the downloaded files, invisibly.
#'
#' @seealso [download_runs()] for the reads, and `seqout_get(x)$bams` to see
#'   what exists before fetching any of it.
#'
#' @export
#' @examples
#' \dontrun{
#' SeqoutGet("SRP071083")$bams # requester-pays inventory
#' DownloadBams("SRP071083")
#' }
download_bams <- function(accession, dest_dir = NULL, quiet = FALSE, con = .con()) {
  .check_connection(con)
  rlang::check_required(accession)

  accession <- trimws(accession)
  if (is.null(dest_dir)) dest_dir <- accession

  bams <- seqout_get(accession, con = con)$bams
  if (!is.data.frame(bams) || nrow(bams) == 0) {
    cli::cli_alert_warning("{accession} has no submitted alignment files.")
    return(invisible(character(0)))
  }

  # the rest are served only to an account that agrees to pay the egress
  urls <- .first_nonempty(bams$url, bams$https_url)
  open <- !is.na(urls)
  if (any(!open)) {
    .warn_paid_bams(bams[!open, , drop = FALSE], nrow(bams), accession)
  }
  if (!any(open)) {
    return(invisible(character(0)))
  }
  .download_files(
    urls[open], dest_dir,
    names = .bam_names(bams)[open], md5 = bams$md5[open], quiet = quiet
  )
}

#' @noRd
.first_nonempty <- function(...) {
  columns <- list(...)
  out <- rep(NA_character_, length(columns[[1]]))
  for (column in columns) {
    value <- as.character(column %||% rep(NA_character_, length(out)))
    take <- is.na(out) & !is.na(value) & nzchar(value)
    out[take] <- value[take]
  }
  out
}

#' Name requester-pays files and how to fetch them
#' @noRd
.warn_paid_bams <- function(paid, total, accession) {
  example <- paid$s3_url[!is.na(paid$s3_url)][1]
  cli::cli_warn(c(
    "{nrow(paid)} of {total} alignment file{?s} {cli::qty(nrow(paid))}{?is/are} in requester-pays storage and cannot be fetched anonymously.",
    "i" = if (!is.na(example)) {
      "Reading {?it/them} bills your own account: {.code aws s3 cp --request-payer requester {example} .}"
    },
    "i" = "The full list, with sizes and checksums, is {.code seqout_get(\"{accession}\")$bams}."
  ))
}

#' Submitters name their own files, so two runs can send the same name
#' @noRd
.bam_names <- function(bams) {
  out <- as.character(bams$filename)
  dup <- duplicated(out) | duplicated(out, fromLast = TRUE)
  out[dup] <- paste0(bams$run_accession[dup], "_", out[dup])
  out
}
