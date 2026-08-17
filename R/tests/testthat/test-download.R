mock_curl <- function(fail_on = character(0), status_404 = character(0),
                      env = parent.frame()) {
  log <- new.env(parent = emptyenv())
  log$calls <- list()
  fake <- function(urls, destfiles, resume = FALSE, progress = FALSE, ...) {
    log$calls <- c(log$calls, list(urls))
    error <- ifelse(urls %in% fail_on, "refused", NA_character_)
    for (i in seq_along(destfiles)) {
      # A network failure still leaves whatever arrived before it; an HTTP
      # error leaves the server's error page.
      writeLines(if (is.na(error[i])) "x" else "partial", destfiles[i])
    }
    data.frame(
      url = urls, error = error,
      status_code = ifelse(urls %in% status_404, 404L, 200L),
      stringsAsFactors = FALSE
    )
  }
  testthat::local_mocked_bindings(
    multi_download = fake, .package = "curl", .env = env
  )
  log
}

test_that("an ftp url that fails is retried over https", {
  ftp <- "ftp://ftp.ncbi.nlm.nih.gov/geo/samples/GSM1/suppl/GSM1_matrix.mtx.gz"
  log <- mock_curl(fail_on = ftp)
  dir <- withr::local_tempdir()
  expect_message(
    seqout:::.curl_download(ftp, file.path(dir, "m.mtx.gz")),
    "retrying"
  )
  expect_length(log$calls, 2)
  expect_equal(log$calls[[2]], sub("^ftp://", "https://", ftp))
})

test_that("only the failed ftp urls are retried", {
  urls <- c(
    "ftp://ftp.ncbi.nlm.nih.gov/a.gz",
    "ftp://ftp.ncbi.nlm.nih.gov/b.gz",
    "https://example.org/c.gz"
  )
  log <- mock_curl(fail_on = urls[2])
  dir <- withr::local_tempdir()
  suppressMessages(
    seqout:::.curl_download(urls, file.path(dir, c("a.gz", "b.gz", "c.gz")))
  )
  expect_equal(log$calls[[2]], "https://ftp.ncbi.nlm.nih.gov/b.gz")
})

test_that("a failing https url is not retried, there is nowhere to fall back to", {
  url <- "https://example.org/a.gz"
  log <- mock_curl(fail_on = url)
  dir <- withr::local_tempdir()
  expect_error(
    seqout:::.curl_download(url, file.path(dir, "a.gz")),
    "Download failed"
  )
  expect_length(log$calls, 1)
})

test_that("nothing is retried when every download works", {
  log <- mock_curl()
  dir <- withr::local_tempdir()
  seqout:::.curl_download("ftp://host/a.gz", file.path(dir, "a.gz"))
  expect_length(log$calls, 1)
})

test_that("a file already on disk is not fetched again", {
  log <- mock_curl()
  dir <- withr::local_tempdir()
  writeLines("cached", file.path(dir, "a.gz"))
  .download_files("https://host/a.gz", dir, quiet = TRUE)
  expect_length(log$calls, 0)
})

test_that("download_files returns one path per url, in order", {
  mock_curl()
  dir <- withr::local_tempdir()
  paths <- .download_files(c("https://host/a.gz", "https://host/b.gz"), dir, quiet = TRUE)
  expect_equal(basename(paths), c("a.gz", "b.gz"))
})

test_that("an empty url list downloads nothing", {
  dir <- withr::local_tempdir()
  expect_equal(.download_files(character(0), dir), character(0))
})

test_that(".dest_paths keeps colliding basenames apart", {
  urls <- c(
    "https://host/GSM1/filtered_feature_bc_matrix/matrix.mtx.gz",
    "https://host/GSM2/filtered_feature_bc_matrix/matrix.mtx.gz",
    "https://host/GSE1_meta.csv.gz"
  )
  paths <- .dest_paths(urls, "d")
  expect_equal(length(unique(paths)), 3L)
  # A name that does not collide is not lengthened.
  expect_equal(paths[3], file.path("d", "GSE1_meta.csv.gz"))
  expect_true(all(grepl("GSM1|GSM2", basename(paths[1:2]))))
})

test_that("download_supplementary refuses a run rather than widening to its study", {
  local_mocked_bindings(
    seqout_get = function(accession, con = NULL) list(project = "SRP123456")
  )
  expect_error(
    download_supplementary("SRR13927092", con = fake_con()),
    "belong to its project"
  )
})

test_that("a partial download keeps its .part name so it is not taken for done", {
  url <- "https://example.org/a.gz"
  mock_curl(fail_on = url)
  dir <- withr::local_tempdir()
  expect_error(suppressMessages(.download_files(url, dir, quiet = TRUE)), "Download failed")
  expect_false(file.exists(file.path(dir, "a.gz")))
  expect_true(file.exists(file.path(dir, "a.gz.part")))
})

test_that("an http error status is a failure, and its body is not kept", {
  url <- "https://example.org/missing.gz"
  mock_curl(status_404 = url)
  dir <- withr::local_tempdir()
  expect_error(.download_files(url, dir, quiet = TRUE), "HTTP 404")
  expect_false(file.exists(file.path(dir, "missing.gz")))
  expect_false(file.exists(file.path(dir, "missing.gz.part")))
})

test_that("a GSA study reaches its files through every linked GEO twin", {
  local_mocked_bindings(
    project_xref = function(accession, con = NULL) {
      tibble::tibble(accession = c("SRP111", "GSE1", "GSE2"))
    }
  )
  expect_equal(seqout:::.geo_twins(fake_con(), "CRA027437"), c("GSE1", "GSE2"))
})

test_that("a study with no GEO twin reaches no files", {
  local_mocked_bindings(
    project_xref = function(accession, con = NULL) tibble::tibble()
  )
  expect_equal(seqout:::.geo_twins(fake_con(), "CRA027437"), character(0))
})

fake_runs <- function(..., n = 2) {
  cols <- list(...)
  base <- tibble::tibble(run_accession = paste0("SRR", seq_len(n)))
  for (k in names(cols)) base[[k]] <- cols[[k]]
  base
}

mock_runs <- function(runs, env = parent.frame()) {
  got <- new.env(parent = emptyenv())
  testthat::local_mocked_bindings(
    seqout_get = function(accession, con = NULL) list(runs = runs),
    .download_files = function(urls, dest_dir, names = NULL, ...) {
      got$urls <- urls
      got$names <- names
      invisible(names)
    },
    .env = env
  )
  got
}

test_that("auto falls through to the NCBI copy when ENA has no fastq", {
  got <- mock_runs(fake_runs(
    fastq_ftp = c(NA, NA),
    ncbi_sra_lite_url = c("https://h/SRR1.lite.1", "https://h/SRR2.lite.1")
  ))
  warnings <- testthat::capture_warnings(download_runs("SRP1", quiet = TRUE))
  expect_true(any(grepl("first copy each run offers", warnings)))
  expect_equal(got$names, c("SRR1.sra", "SRR2.sra"))
})

test_that("ENA fastq keeps the names downstream tools glob for", {
  got <- mock_runs(fake_runs(
    fastq_ftp = c("ftp://h/SRR1_1.fastq.gz;ftp://h/SRR1_2.fastq.gz", "ftp://h/SRR2_1.fastq.gz")
  ))
  suppressWarnings(download_runs("SRP1", quiet = TRUE))
  expect_equal(got$names, c("SRR1_1.fastq.gz", "SRR1_2.fastq.gz", "SRR2_1.fastq.gz"))
})

test_that("naming a mode silences the mode warning but not the study one", {
  mock_runs(fake_runs(fastq_ftp = c("ftp://h/a.gz", "ftp://h/b.gz")))
  warnings <- testthat::capture_warnings(
    download_runs("SRP1", mode = "fastq", quiet = TRUE)
  )
  expect_false(any(grepl("No `mode` given", warnings)))
  expect_true(any(grepl("is a study", warnings)))
})

test_that("a run accession downloads its own files, with no study warning", {
  mock_runs(fake_runs(fastq_ftp = "ftp://h/a.gz", n = 1))
  warnings <- testthat::capture_warnings(download_runs("SRR1", quiet = TRUE))
  expect_false(any(grepl("is a study", warnings)))
})

test_that("runs with no downloadable copy are counted, not dropped in silence", {
  got <- mock_runs(fake_runs(fastq_ftp = c("ftp://h/a.gz", NA)))
  warnings <- testthat::capture_warnings(download_runs("SRP1", quiet = TRUE))
  expect_true(any(grepl("1 of 2 runs has no downloadable copy", warnings)))
  expect_length(got$urls, 1)
})

test_that("cloud modes are refused before anything is fetched", {
  expect_error(
    download_runs("SRP1", mode = "s3", con = fake_con()),
    "requester-pays"
  )
})

test_that("a study serving no copy at all errors rather than downloading nothing", {
  mock_runs(fake_runs(library_layout = c("PAIRED", "PAIRED")))
  expect_error(download_runs("SRP1", quiet = TRUE), "No run of SRP1 is served")
})

test_that("a body that does not match its checksum is a failure, not a file", {
  url <- "https://example.org/a.gz"
  mock_curl()
  dir <- withr::local_tempdir()
  expect_error(
    .download_files(url, dir, md5 = "0000000000000000000000000000dead", quiet = TRUE),
    "checksum mismatch"
  )
  expect_false(file.exists(file.path(dir, "a.gz")))
  # A corrupt body must not be resumed into on the next call.
  expect_false(file.exists(file.path(dir, "a.gz.part")))
})

test_that("a matching checksum lets the file through", {
  mock_curl()
  dir <- withr::local_tempdir()
  # mock_curl writes "x\n" for every successful download.
  want <- unname(tools::md5sum(withr::local_tempfile(lines = "x")))
  paths <- .download_files("https://example.org/a.gz", dir, md5 = want, quiet = TRUE)
  expect_true(file.exists(paths))
})

test_that("fastq checksums are paired with fastq urls, and dropped when they do not line up", {
  runs <- tibble::tibble(
    run_accession = c("SRR1", "SRR2"),
    fastq_ftp = c("ftp://h/a_1.gz;ftp://h/a_2.gz", "ftp://h/b_1.gz"),
    fastq_md5 = c("aaa;bbb", "ccc;ddd")
  )
  picked <- seqout:::.pick_run_files(runs, seqout:::.run_auto_order)
  expect_equal(picked$md5[[1]], c("aaa", "bbb"))
  expect_equal(picked$md5[[2]], NA_character_)
})

test_that("the sra mode prefers the anonymous AWS mirror over the NCBI host", {
  runs <- tibble::tibble(
    run_accession = "SRR1",
    ncbi_sra_url = "https://sra-downloadb/lite",
    ncbi_sra_url_aws = "https://sra-pub-run-odp/full",
    ncbi_sra_lite_url = "https://sra-downloadb/lite"
  )
  picked <- seqout:::.pick_run_files(runs, seqout:::.run_auto_order)
  expect_equal(picked$source, "sra")
  expect_equal(picked$column, "ncbi_sra_url_aws")
})

test_that("ENA's scheme-less paths are fetched over https, not guessed as ftp", {
  log <- mock_curl()
  dir <- withr::local_tempdir()
  .download_files("ftp.sra.ebi.ac.uk/vol1/fastq/SRR1/SRR1_1.fastq.gz", dir, quiet = TRUE)
  expect_equal(log$calls[[1]], "https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR1/SRR1_1.fastq.gz")
  # An explicit scheme is left alone, so the ftp fallback still has work to do.
  expect_equal(seqout:::.with_scheme("ftp://h/a.gz"), "ftp://h/a.gz")
})
