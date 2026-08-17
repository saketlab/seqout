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
