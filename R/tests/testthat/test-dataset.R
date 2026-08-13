test_that("dataset accepts any accession and records what it is", {
  con <- fake_con()
  expect_equal(dataset(con = con, "GSE168652")$kind, "series")
  expect_equal(dataset(con = con, "SRR13927092")$kind, "run")
  expect_equal(dataset(con = con, "SRX10306523")$kind, "experiment")
  expect_equal(dataset(con = con, "SAMEA7015536")$kind, "biosample")
})

test_that("dataset rejects an accession it does not recognise", {
  expect_error(dataset(con = fake_con(), "nonsense"), "not an accession")
})

test_that("dataset trims surrounding whitespace", {
  expect_equal(dataset(con = fake_con(), "  GSE168652 ")$accession, "GSE168652")
})

test_that("dataset requires a connection", {
  expect_error(dataset("GSE168652", con = "not a connection"), "seqout_connection")
})

test_that("a study or series is its own project, with no request", {
  expect_equal(dataset(con = fake_con(), "GSE168652")$project, "GSE168652")
  expect_equal(dataset(con = fake_con(), "SRP310139")$project, "SRP310139")
  expect_equal(dataset(con = fake_con(), "CRA002740")$project, "CRA002740")
})

test_that("a study is its own sra, and a series its own geo", {
  expect_equal(dataset(con = fake_con(), "SRP310139")$sra, "SRP310139")
  expect_equal(dataset(con = fake_con(), "GSE168652")$geo, "GSE168652")
})

test_that("fields are cached, so a second read makes no new request", {
  d <- dataset(con = fake_con(), "GSE168652")
  expect_length(ls(d$cache), 0)
  d$project
  expect_true("project" %in% ls(d$cache))
  assign("project", "SENTINEL", envir = d$cache)
  expect_equal(d$project, "SENTINEL")
})

test_that("detail is NULL for a study or series", {
  expect_null(dataset(con = fake_con(), "GSE168652")$detail)
  expect_null(dataset(con = fake_con(), "SRP310139")$detail)
})

test_that("asking for a field that does not exist is an error, not NULL", {
  d <- dataset(con = fake_con(), "GSE168652")
  expect_error(d$not_a_field, "not a field")
})

test_that("the plumbing fields stay reachable", {
  d <- dataset(con = fake_con(), "GSE168652")
  expect_s3_class(d$con, "seqout_connection")
  expect_equal(d$accession, "GSE168652")
  expect_true(all(c("project", "meta", "samples", "runs", "pubs") %in% names(d)))
})

test_that("dataset prints without fetching anything", {
  d <- dataset(con = fake_con(), "GSE168652")
  expect_message(print(d), "GSE168652")
  expect_length(ls(d$cache), 0)
})

test_that("both spellings build the same object", {
  expect_equal(Dataset(con = fake_con(), "GSE168652")$kind, dataset(con = fake_con(), "GSE168652")$kind)
})
