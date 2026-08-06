mock_curl <- function(fail_on = character(0), env = parent.frame()) {
  log <- new.env(parent = emptyenv())
  log$calls <- list()
  fake <- function(urls, destfiles, resume = FALSE, progress = FALSE, ...) {
    log$calls <- c(log$calls, list(urls))
    error <- ifelse(urls %in% fail_on, "refused", NA_character_)
    for (i in seq_along(destfiles)) {
      if (is.na(error[i])) writeLines("x", destfiles[i])
    }
    data.frame(url = urls, error = error, stringsAsFactors = FALSE)
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
  expect_warning(
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
  download_files("https://host/a.gz", dir, quiet = TRUE)
  expect_length(log$calls, 0)
})

test_that("download_files returns one path per url, in order", {
  mock_curl()
  dir <- withr::local_tempdir()
  paths <- download_files(c("https://host/a.gz", "https://host/b.gz"), dir, quiet = TRUE)
  expect_equal(basename(paths), c("a.gz", "b.gz"))
})

test_that("an empty url list downloads nothing", {
  dir <- withr::local_tempdir()
  expect_equal(download_files(character(0), dir), character(0))
})
