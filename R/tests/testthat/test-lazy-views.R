fake_con <- function(registered = character(0)) {
  views <- new.env(parent = emptyenv())
  for (v in registered) assign(v, TRUE, envir = views)
  structure(
    list(
      db = NULL, base_url = "https://example.org",
      data_url = "https://example.org/data",
      api_url = "https://example.org/api",
      tables = seqout:::.seqout_tables(), views = views
    ),
    class = "seqout_connection"
  )
}

with_recorded_views <- function(con, expr) {
  run <- new.env(parent = emptyenv())
  run$sql <- character(0)
  testthat::local_mocked_bindings(
    dbExecute = function(conn, statement, ...) {
      run$sql <- c(run$sql, statement)
      0L
    },
    .package = "DBI",
    .env = parent.frame()
  )
  force(expr)
  run
}

test_that("only the tables a statement names are registered", {
  con <- fake_con()
  run <- with_recorded_views(con, seqout:::.ensure_views(
    con, "SELECT accession FROM geo_series LIMIT 1"
  ))
  expect_equal(ls(con$views), "geo_series")
  expect_length(run$sql, 1)
  expect_true(grepl("geo_series.parquet", run$sql, fixed = TRUE))
})

test_that("a statement naming two tables registers both", {
  con <- fake_con()
  with_recorded_views(con, seqout:::.ensure_views(
    con, "SELECT * FROM geo_series JOIN geo_samples ON TRUE"
  ))
  expect_setequal(ls(con$views), c("geo_series", "geo_samples"))
})

test_that("an already registered view is not created twice", {
  con <- fake_con(registered = "geo_series")
  run <- with_recorded_views(con, seqout:::.ensure_views(
    con, "SELECT accession FROM geo_series"
  ))
  expect_length(run$sql, 0)
})

test_that("a statement naming no table registers nothing", {
  con <- fake_con()
  run <- with_recorded_views(con, seqout:::.ensure_views(con, "SELECT 1"))
  expect_length(run$sql, 0)
  expect_length(ls(con$views), 0)
})

test_that("registration is recorded on the connection's environment", {
  con <- fake_con()
  with_recorded_views(con, seqout:::.register_views(con, c("sra_runs", "ena_samples")))
  expect_setequal(ls(con$views), c("sra_runs", "ena_samples"))
})

test_that("register_tables rejects a name that is not a SeqOut table", {
  expect_error(register_tables(fake_con(), "not_a_table"), "Not a SeqOut table")
})

test_that("register_tables defaults to every table", {
  con <- fake_con()
  run <- with_recorded_views(con, register_tables(con, progress = FALSE))
  expect_length(run$sql, length(seqout:::.seqout_tables()))
})

test_that("connect exposes the table list without registering any view", {
  con <- fake_con()
  expect_length(con$tables, length(seqout:::.seqout_tables()))
  expect_length(ls(con$views), 0)
})

test_that("seqout_connect defaults to lazy", {
  expect_false(eval(formals(seqout_connect)$eager))
})
