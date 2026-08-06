test_that("query runs SQL on DuckDB connection", {
  skip_on_cran()
  skip_if_offline()

  con <- seqout_connect()
  withr::defer(seqout_close(con))

  result <- query(con, "SELECT 1 AS value")
  expect_equal(nrow(result), 1)
  expect_equal(result$value, 1)
})

test_that("query with params works", {
  skip_on_cran()
  skip_if_offline()

  con <- seqout_connect()
  withr::defer(seqout_close(con))

  result <- query(con, "SELECT ? AS value", params = list(42))
  expect_equal(result$value, 42)
})
