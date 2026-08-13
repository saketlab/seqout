test_that("query runs SQL on DuckDB connection", {
  skip_on_cran()
  skip_if_offline()
  skip_if_not_installed("duckdb")

  con <- seqout_connect("parquet", quiet = TRUE)
  withr::defer(seqout_close(con))

  result <- query("SELECT 1 AS value", con = con)
  expect_equal(nrow(result), 1)
  expect_equal(result$value, 1)
})

test_that("query with params works", {
  skip_on_cran()
  skip_if_offline()
  skip_if_not_installed("duckdb")

  con <- seqout_connect("parquet", quiet = TRUE)
  withr::defer(seqout_close(con))

  result <- query("SELECT ? AS value", params = list(42), con = con)
  expect_equal(result$value, 42)
})

test_that("query refuses a REST connection", {
  con <- seqout_connect("api", quiet = TRUE)
  expect_error(query("SELECT 1", con = con), "Parquet backend")
})
