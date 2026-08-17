test_that("the default backend is REST and opens nothing", {
  con <- seqout_connect(quiet = TRUE)
  expect_s3_class(con, "seqout_connection")
  expect_equal(con$backend, "api")
  expect_null(con$state$db)
  expect_message(print(con), "REST")
})

test_that("seqout_connect builds a Parquet connection lazily", {
  con <- seqout_connect("parquet", quiet = TRUE)
  expect_equal(con$backend, "parquet")
  expect_true(length(con$tables) > 0)
  # No DuckDB handle until something queries it, so this needs no duckdb install.
  expect_null(con$state$db)
  expect_message(print(con), "Parquet")
})

test_that("seqout_connect rejects an unknown backend", {
  expect_error(seqout_connect("sqlite"), "should be one of")
})

test_that("no connection is opened until a call needs one", {
  withr::defer(seqout_default(NULL))
  seqout_default(NULL)
  expect_null(seqout:::.seqout_state$default)
  expect_s3_class(seqout:::.con(), "seqout_connection")
  expect_equal(seqout:::.con()$backend, "api")
})

test_that("seqout_default overrides what .con() hands out", {
  withr::defer(seqout_default(NULL))
  pq <- seqout_connect("parquet", quiet = TRUE)
  seqout_default(pq)
  expect_identical(seqout:::.con(), pq)
})

test_that("seqout_default rejects non-connections", {
  expect_error(seqout_default("nope"), "seqout_connection")
})

test_that("parquet-only functions name the fix in the error", {
  rest <- seqout_connect("api", quiet = TRUE)
  expect_error(tables(con = rest), "seqout_connect")
  expect_error(query("SELECT 1", con = rest), "Parquet backend")
})

test_that("seqout_connect rejects bad base_url gracefully", {
  skip_on_cran()

  con <- seqout_connect(base_url = "https://nonexistent.example.com", quiet = TRUE)
  expect_s3_class(con, "seqout_connection")
  seqout_close(con)
})

test_that(".check_connection rejects non-connection objects", {
  expect_error(
    seqout:::.check_connection("not a connection"),
    "seqout_connection"
  )
})

test_that("data_dir points the views at a dump of your own", {
  dir <- withr::local_tempdir()
  con <- seqout_connect("parquet", data_dir = dir, quiet = TRUE)
  expect_equal(con$data_url, dir)

  # base_url still builds the API URL, so the two cannot be confused.
  expect_equal(con$api_url, "https://seqout.org/api")
})

test_that("data_dir defaults to the published dump", {
  con <- seqout_connect("parquet", quiet = TRUE)
  expect_equal(con$data_url, "https://seqout.org/data")
})

test_that("a trailing slash and a ~ are both accepted", {
  dir <- withr::local_tempdir()
  con <- seqout_connect("parquet", data_dir = paste0(dir, "/"), quiet = TRUE)
  expect_equal(con$data_url, dir)
})

test_that("a URL is passed through, since only a path can be checked", {
  con <- seqout_connect("parquet",
    data_dir = "https://example.org/dump", quiet = TRUE
  )
  expect_equal(con$data_url, "https://example.org/dump")
})

test_that("a data_dir that is not there fails now, not once per table", {
  expect_error(
    seqout_connect("parquet", data_dir = "/no/such/dump"),
    "not a directory"
  )
  expect_error(seqout_connect("parquet", data_dir = 42), "one directory or URL")
})

test_that("data_dir on the api backend says so instead of being ignored", {
  dir <- withr::local_tempdir()
  expect_warning(
    con <- seqout_connect("api", data_dir = dir, quiet = TRUE),
    "does nothing"
  )
  expect_equal(con$data_url, "https://seqout.org/data")
})
