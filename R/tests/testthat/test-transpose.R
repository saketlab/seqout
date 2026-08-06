test_that("a wide row becomes one row per field", {
  x <- tibble::tibble(accession = "GSE1", title = "t", summary = "s")
  out <- seqout:::.as_fields(x)
  expect_equal(out$field, c("accession", "title", "summary"))
  expect_equal(out$value, c("GSE1", "t", "s"))
  expect_equal(nrow(out), ncol(x))
})

test_that("a list column is flattened rather than printed as <list>", {
  x <- tibble::tibble(
    accession = "GSE1",
    organisms = list(list("Homo sapiens", "Mus musculus"))
  )
  expect_equal(seqout:::.as_fields(x)$value, c("GSE1", "Homo sapiens; Mus musculus"))
})

test_that("an empty list column reads as NA, not an empty string", {
  x <- tibble::tibble(accession = "GSE1", neighbors = list(list()))
  expect_equal(seqout:::.as_fields(x)$value[2], NA_character_)
})

test_that("NA entries inside a list column are dropped", {
  x <- tibble::tibble(a = list(list("x", NA_character_, "y")))
  expect_equal(seqout:::.as_fields(x)$value, "x; y")
})

test_that("both columns come back as character, whatever went in", {
  x <- tibble::tibble(n = 42L, flag = TRUE, when = "2025-06-30")
  out <- seqout:::.as_fields(x)
  expect_type(out$field, "character")
  expect_type(out$value, "character")
  expect_equal(out$value, c("42", "TRUE", "2025-06-30"))
})

test_that("no rows gives an empty two-column frame", {
  out <- seqout:::.as_fields(tibble::tibble(a = character(0)))
  expect_equal(names(out), c("field", "value"))
  expect_equal(nrow(out), 0L)
})

test_that("more than one row is an error rather than a silent pick", {
  x <- tibble::tibble(a = c("1", "2"))
  expect_error(seqout:::.as_fields(x), "single-row")
})

test_that("project and project_metadata both take transpose", {
  expect_true("transpose" %in% names(formals(project)))
  expect_true("transpose" %in% names(formals(project_metadata)))
  expect_false(eval(formals(project)$transpose))
  expect_false(eval(formals(project_metadata)$transpose))
})
