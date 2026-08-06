with_recorded_views <- function(expr) {
  sql <- character(0)
  testthat::local_mocked_bindings(
    dbExecute = function(conn, statement, ...) {
      sql <<- c(sql, statement)
      0L
    },
    .package = "DBI"
  )
  force(expr)
  sql
}

test_that("only the tables a statement names are registered", {
  con <- fake_con()
  sql <- with_recorded_views(seqout:::.ensure_views(
    con, "SELECT accession FROM geo_series LIMIT 1"
  ))
  expect_equal(ls(con$views), "geo_series")
  expect_length(sql, 1)
  expect_true(grepl("geo_series.parquet", sql, fixed = TRUE))
})

test_that("a statement naming two tables registers both", {
  con <- fake_con()
  with_recorded_views(seqout:::.ensure_views(
    con, "SELECT * FROM geo_series JOIN geo_samples ON TRUE"
  ))
  expect_setequal(ls(con$views), c("geo_series", "geo_samples"))
})

test_that("an already registered view is not created twice", {
  con <- fake_con(registered = "geo_series")
  sql <- with_recorded_views(seqout:::.ensure_views(
    con, "SELECT accession FROM geo_series"
  ))
  expect_length(sql, 0)
})

test_that("a statement naming no table registers nothing", {
  con <- fake_con()
  sql <- with_recorded_views(seqout:::.ensure_views(con, "SELECT 1"))
  expect_length(sql, 0)
  expect_length(ls(con$views), 0)
})

test_that("registration is recorded on the connection's environment", {
  con <- fake_con()
  with_recorded_views(seqout:::.register_views(con, c("sra_runs", "ena_samples")))
  expect_setequal(ls(con$views), c("sra_runs", "ena_samples"))
})

test_that("register_tables rejects a name that is not a SeqOut table", {
  expect_error(register_tables(fake_con(), "not_a_table"), "Not a SeqOut table")
})

test_that("register_tables defaults to every table", {
  con <- fake_con()
  sql <- with_recorded_views(register_tables(con, progress = FALSE))
  expect_length(sql, length(seqout:::.seqout_tables()))
})

test_that("connect exposes the table list without registering any view", {
  con <- fake_con()
  expect_length(con$tables, length(seqout:::.seqout_tables()))
  expect_length(ls(con$views), 0)
})

test_that("seqout_connect defaults to lazy", {
  expect_false(formals(seqout_connect)$eager)
})

test_that("no query path bypasses the view registration hook", {
  # .db_query is the only place .ensure_views runs; a direct DBI call against a
  # remote table fails on a cold connection
  files <- list.files("../../R", pattern = "[.]R$", full.names = TRUE)
  if (length(files) == 0) skip("package sources not available")
  allowed <- c("api.R", "connection.R", "cache.R")
  offenders <- character(0)
  for (f in files) {
    if (basename(f) %in% allowed) next
    lines <- readLines(f, warn = FALSE)
    if (any(grepl("DBI::dbGetQuery", lines, fixed = TRUE))) {
      offenders <- c(offenders, basename(f))
    }
  }
  expect_equal(offenders, character(0))
})
