test_that("seqout_connect creates valid connection object", {
  skip_on_cran()
  skip_if_offline()

  con <- seqout_connect()
  expect_s3_class(con, "seqout_connection")
  expect_true(length(con$tables) > 0)

  expect_message(print(con), "seqout_connection")

  tbls <- tables(con)
  expect_true(nrow(tbls) > 0)

  seqout_close(con)
})

test_that("seqout_connect rejects bad base_url gracefully", {
  skip_on_cran()

  con <- seqout_connect(base_url = "https://nonexistent.example.com")
  expect_s3_class(con, "seqout_connection")
  seqout_close(con)
})

test_that(".check_connection rejects non-connection objects", {
  expect_error(
    seqout:::.check_connection("not a connection"),
    "seqout_connection"
  )
})
