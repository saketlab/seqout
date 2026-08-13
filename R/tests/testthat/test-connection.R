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
  expect_error(list_organisms(con = rest), "Parquet backend")
  expect_error(global_contributions(con = rest), "Parquet backend")
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
