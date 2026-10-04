# The handle keeps its own assay, apart from the units table's column.
counts_table <- function(cache_dir, n_units = 3L) {
  handle <- structure(
    list(
      accession = "GSE1", assay = "rna", feature_type = NULL,
      cache_dir = cache_dir, cache = new.env(parent = emptyenv())
    ),
    class = "seqout_counts"
  )
  out <- tibble::tibble(
    unit = paste0("GSM", seq_len(n_units)), sample = paste0("GSM", seq_len(n_units)),
    format = "tar", assay = NA_character_, preferred = TRUE
  )
  structure(out, class = c("seqout_counts", class(out)), .counts_handle = handle)
}

test_that("internals read the handle's assay, not the units column", {
  cn <- counts_table(tempdir())
  expect_length(cn$assay, 3L)
  expect_identical(seqout:::.handle(cn)$assay, "rna")
  handle <- seqout:::.handle(cn)
  expect_identical(seqout:::.handle(handle), handle)
})

test_that("a tar unit reads when the table has an assay column", {
  skip_if_not_installed("Matrix")
  dir <- withr::local_tempdir()
  inner <- file.path(dir, "GSM1_processed")
  dir.create(inner)
  m <- Matrix::Matrix(c(1, 0, 0, 2, 3, 0, 0, 4, 5, 0, 6, 0), nrow = 3, sparse = TRUE)
  Matrix::writeMM(m, file.path(inner, "matrix.mtx"))
  writeLines(
    paste0("AAACCTGAGAAACC", c("AT", "GC", "TT", "GG"), "-1"),
    file.path(inner, "barcodes.tsv")
  )
  writeLines(c("GeneA", "GeneB", "GeneC"), file.path(inner, "features.tsv"))
  tar_path <- file.path(dir, "GSM1_processed.tar")
  withr::with_dir(dir, utils::tar(tar_path, "GSM1_processed"))

  cn <- counts_table(withr::local_tempdir())
  unit <- list(
    label = "GSM1", fmt = "tar", sample = "GSM1",
    files = list(list(url = tar_path, role = "tar", name = basename(tar_path))),
    metadata_files = list()
  )

  out <- seqout:::.read_unit(cn, unit)
  expect_identical(dim(out$X), c(3L, 4L))
})

test_that("an rds unit reads when the table has an assay column", {
  dir <- withr::local_tempdir()
  X <- matrix(1:6, nrow = 3, dimnames = list(c("g1", "g2", "g3"), c("c1", "c2")))
  path <- file.path(dir, "GSM1_counts.rds")
  saveRDS(X, path)

  cn <- counts_table(dir)
  unit <- list(
    label = "GSM1", fmt = "rds", sample = "GSM1",
    files = list(list(url = path, role = "rds", name = basename(path))),
    metadata_files = list()
  )

  out <- seqout:::.read_unit(cn, unit)
  expect_identical(dim(out$X), c(3L, 2L))
})

test_that("a vector assay fails with a clear message", {
  expect_error(seqout:::.modality_rank("GSM1_rna.mtx", c(NA, NA)), "must be one modality")
  expect_error(seqout:::.pick_assay(c("RNA", "ADT"), c("rna", "adt")), "must be one modality")
})

test_that("GSE192693 tar units read end to end", {
  skip_on_cran()
  skip_if_offline()
  out <- seqout_matrix(seqout_counts("GSE192693"), sample = "GSM5761209")
  expect_gt(nrow(out$X), 20000)
  expect_gt(ncol(out$X), 10000)
})
