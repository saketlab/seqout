test_that("a plain rds reads back", {
  X <- demo_X()
  path <- withr::local_tempfile(fileext = ".rds")
  saveRDS(X, path)

  expect_identical(dim(seqout:::.read_rds_object(path)), dim(X))
})

test_that("an rds gzipped a second time still reads", {
  # saveRDS() gzips already, so a submitter who gzips the result ships two
  # layers; readRDS() peels one and fails on the header underneath.
  X <- demo_X()
  inner <- withr::local_tempfile(fileext = ".rds")
  saveRDS(X, inner)
  outer <- withr::local_tempfile(fileext = ".rds.gz")
  con <- gzfile(outer, "wb")
  writeBin(readBin(inner, "raw", file.size(inner)), con)
  close(con)

  expect_error(readRDS(outer), "unknown input format")
  expect_identical(dim(seqout:::.read_rds_object(outer)), dim(X))
})

test_that("an uncompressed rds reads", {
  X <- demo_X()
  path <- withr::local_tempfile(fileext = ".rds")
  saveRDS(X, path, compress = FALSE)

  expect_identical(dim(seqout:::.read_rds_object(path)), dim(X))
})

test_that("a corrupt rds still errors", {
  path <- withr::local_tempfile(fileext = ".rds")
  writeBin(as.raw(rep(0L, 64)), path)

  expect_error(seqout:::.read_rds_object(path))
})

test_that("the double-gzipped rds in a real series reads", {
  skip_unless_live()

  counts <- counts_of("GSE139369")
  unit <- counts$unit[counts$sample %in% "GSM4138872" & counts$assay %in% "adt"][[1]]
  m <- live(seqout_matrix(counts, sample = unit))

  expect_equal(nrow(m$X), 21L)
  expect_equal(ncol(m$X), 6270L)
  expect_true(all(grepl("^BMMC_D1T1:", colnames(m$X))))
})

test_that("all_na_rows counts without densifying a sparse matrix", {
  X <- Matrix::sparseMatrix(
    i = c(1L, 1L, 2L), j = c(1L, 2L, 1L),
    x = c(NA_real_, NA_real_, 5), dims = c(3L, 2L)
  )
  # row 1 is NA in both cells, row 2 has a value, row 3 is implicit zero
  expect_equal(seqout:::.all_na_rows(X), 1L)
})

test_that("all_na_rows handles a dense matrix", {
  # column-major, so row 1 is c(1, 2) and row 2 is c(NA, NA)
  X <- matrix(c(1, NA, 2, NA), nrow = 2)
  expect_equal(seqout:::.all_na_rows(X), 1L)
  expect_equal(seqout:::.all_na_rows(matrix(NA_real_, nrow = 2, ncol = 2)), 2L)
  expect_equal(seqout:::.all_na_rows(matrix(1, nrow = 2, ncol = 2)), 0L)
})
