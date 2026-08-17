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
    over_https <- sub("^ftp://", "https://", urls[retry])
    reason[retry] <- .fetch_batched(over_https, parts[retry], resume = FALSE, quiet = quiet)
  }

  # An archive throttling a large request answers some of it and refuses the
  # rest on connect. Those are not gone, they are deferred: asking again a
  # moment later gets them, and whatever arrived already resumes.
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

  # A file takes its real name only once it is whole, so a half-written one is
  # never taken for finished on the next call. What is left behind resumes,
  # unless the server answered with an error page: appending to that would
  # produce a file that is neither the error nor the data.
  ok <- is.na(reason)
  # A server can answer 200 with a body that is short: a proxy that gave up, a
  # disk that filled. Nothing in the response says so, and the archive publishes
  # a checksum for exactly this, so where there is one it decides.
  if (!is.null(md5) && any(ok)) {
    at <- which(ok)
    want <- tolower(md5[at])
    got <- unname(tools::md5sum(parts[at]))
    bad <- !is.na(want) & nzchar(want) & !is.na(got) & got != want
    reason[at[bad]] <- "checksum mismatch"
    ok <- is.na(reason)
  }
  file.rename(parts[ok], paths[ok])
  # An error page or a corrupt body is not something to resume into.
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

#' Fetch in groups rather than queueing every file at once
#'
#' curl holds six connections per host, but it opens a handle for every URL
#' given to it, and an archive handed several hundred at once starts refusing
#' to accept them: a 412-file study failed 232 of them on connect while forty
#' of the same URLs succeeded every time. So ask for a group, finish it, ask
#' for the next.
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
#' curl gives up after ten seconds by default, which reads a queue as a
#' failure. The files behind it are usually served a moment later.
#' @noRd
.connect_timeout <- 60L

#' Give a bare host/path an explicit scheme
#'
#' ENA publishes `fastq_ftp` with no scheme at all --
#' `ftp.sra.ebi.ac.uk/vol1/fastq/...` -- and curl reads the leading `ftp.` as a
#' request for FTP. That fails outright on any network blocking port 21, and the
#' fallback below never fires because the string does not begin `ftp://`. The
#' same paths are served over HTTPS from the same host, with range requests, so
#' name the scheme rather than leave it to be guessed.
#' @noRd
.with_scheme <- function(urls) {
  bare <- !grepl("^[a-z][a-z0-9+.-]*://", urls, ignore.case = TRUE)
  urls[bare] <- paste0("https://", urls[bare])
  urls
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

#' Download the Parquet dump
#'
#' Fetches the `.parquet` files that back the Parquet backend, so that later
#' work reads a local disk instead of the network. Point
#' [seqout_connect()]`(data_dir =)` at the directory afterwards.
#'
#' The whole dump is tens of gigabytes and `geo_series.parquet` alone is over
#' four, so the size is reported before anything is fetched. Name `tables` to
#' take only what you need. A file already on disk is left alone, which makes a
#' second call finish an interrupted first one.
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
#'   one table in local DuckDB storage instead.
#'
#' @export
#' @examples
#' \dontrun{
#' # The two tables most queries start from
#' DownloadDump("~/seqout-dump", tables = c("unified_metadata", "geo_series"))
#'
#' con <- SeqoutConnect("parquet", data_dir = "~/seqout-dump")
#' Query("SELECT count(*) FROM unified_metadata", con = con)
#' }
download_dump <- function(dest_dir = "seqout-dump", tables = NULL,
                          overwrite = FALSE, quiet = FALSE, con = .con()) {
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

#' Say how much this will cost before it starts
#'
#' A HEAD per file, which is cheap next to the transfer it is describing. The
#' whole dump is far past the point where a caller should find out afterwards.
#' A server that will not answer HEAD is not a reason to refuse the download.
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
#' The processed files a submitter uploaded: count matrices, annotations and
#' archives. A series or study downloads its own files and every sample's; a GEO
#' sample downloads only its own. An experiment, run or BioSample carries no
#' files of its own, so it names the project to ask for rather than widening to
#' the whole study.
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

#' Download the read files of an accession
#'
#' Takes any accession: a run downloads its own files, an experiment or sample
#' downloads its runs', a series or study downloads every run's.
#'
#' Not every run is served in every form. Left to itself the function takes the
#' first copy each run offers, preferring ENA fastq, then NCBI's full-quality
#' SRA copy, then its `lite` copy, and says which it took. Name `mode` to insist
#' on one.
#'
#' Where the archive publishes a checksum, which it does for every fastq, the
#' downloaded file is verified against it.
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

#' Say what is about to be downloaded, and on whose authority
#'
#' Two things a caller cannot see from the call itself: which copy was chosen
#' when they named none, and that one accession stands for the whole study.
#' Both warn rather than stop, so a script still runs.
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
    # The count that agrees is the first one, not the last cli saw.
    cli::cli_warn(
      "{sum(!found)} of {length(found)} run{?s} {cli::qty(sum(!found))}{?has/have} no downloadable copy and {?is/are} skipped."
    )
  }
}

#' The three forms a run's reads come in, and where each is served
#'
#' The run table carries eight URL columns, but they hold three things. The
#' archives publish the reads as ENA fastq, as NCBI's full-quality `normalized`
#' SRA copy, and as its `lite` copy, whose quality scores are binned. The rest
#' of the columns are the same two SRA objects under different hosts:
#' `ncbi_sra_url_aws` is byte-for-byte the normalized URL (355,481 of 355,481
#' rows sampled) and `ncbi_sra_url` is the lite one (340,470 of 340,554). So a
#' mode names the copy and the columns under it name the hosts, best first.
#'
#' `ncbi_sra_url_aws` leads because it is anonymous, egress-free worldwide and
#' answers range requests, so a part-finished file resumes.
#' @noRd
.run_modes <- list(
  fastq = "fastq_ftp",
  sra = c("ncbi_sra_url_aws", "ncbi_sra_normalized_url", "sra_ftp"),
  sra_lite = c("ncbi_sra_lite_url", "ncbi_sra_url")
)

#' Preference order when the caller names no mode
#'
#' Fastq first: it needs no conversion. Then the full-quality SRA copy. The
#' lite copy last, because binned quality scores are a loss the caller should
#' choose rather than be handed.
#' @noRd
.run_auto_order <- c("fastq", "sra", "sra_lite")

#' Modes that were once offered and now are not
#'
#' `s3` and `gcs` name the same objects behind requester-pays buckets, which
#' curl cannot fetch and which bill the caller.
#' @noRd
.run_paid_modes <- c("s3", "gcs")

#' Checksums and sizes, by the column the URL came from
#'
#' Only the archives' own copies are published with a checksum; NCBI serves the
#' SRA copies without one.
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
#' A run offering nothing at all keeps `NA` as its source, so the caller can
#' count what it is leaving behind rather than quietly shipping a subset.
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
        # A paired run packs both mates into one cell, and its checksums the
        # same way, in the same order.
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
  # Only trust a checksum list that lines up with the URL list.
  if (length(found) != n) {
    return(rep(NA_character_, n))
  }
  found
}

#' What each run file is called on disk
#'
#' ENA already names its files for the run, and the `_1`/`_2` suffixes are what
#' every downstream tool globs for, so those are kept. NCBI serves the SRA
#' copies under names carrying no usable extension at all -- `SRR12012336` for
#' the normalized copy, `SRR12012336.lite.1` for the lite one -- so those are
#' named for their run instead.
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
#' Distinct from [download_runs()], which fetches reads. These are the
#' submitter's own BAMs, aligned to a reference they chose and often carrying
#' work the reads alone do not reconstruct: barcode tags, methylation calls,
#' long-read structural evidence. Realigning from fastq gives you neither those
#' nor their coordinates.
#'
#' Most are held in requester-pays storage, which no anonymous client can read.
#' Those are named rather than fetched, with the command that would get them.
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
#' SeqoutGet("SRP071083")$bams # 276 files, 410 GB, all requester-pays
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

  # The archive gives a direct URL for some and an anonymous mirror for others;
  # the rest it will serve only to an account that agrees to pay the egress.
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

#' Name the files that could not be fetched, and how to fetch them
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
