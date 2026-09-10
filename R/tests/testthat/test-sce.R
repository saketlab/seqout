test_that("seqout_sce carries X, obs and var into the three slots", {
  skip_if_not_installed("SingleCellExperiment")
  skip_if_not_installed("Matrix")

  sce <- seqout_sce(mock_matrix(demo_X(), demo_obs(), demo_var()))

  expect_s4_class(sce, "SingleCellExperiment")
  expect_equal(dim(sce), c(3, 2))
  expect_identical(SummarizedExperiment::assayNames(sce), "counts")
  expect_identical(SingleCellExperiment::counts(sce), demo_X())
  expect_identical(sce$group, c("a", "b"))
  expect_identical(
    SummarizedExperiment::rowData(sce)$symbol, c("A", "B", "C")
  )
})

test_that("assay_name renames the assay", {
  skip_if_not_installed("SingleCellExperiment")
  skip_if_not_installed("Matrix")

  sce <- seqout_sce(mock_matrix(demo_X()), assay_name = "tpm")
  positional <- seqout_sce(mock_matrix(demo_X()), "logcounts")

  expect_identical(SummarizedExperiment::assayNames(sce), "tpm")
  expect_identical(SummarizedExperiment::assayNames(positional), "logcounts")
  expect_error(seqout_sce(mock_matrix(demo_X()), assay_name = c("a", "b")), "one name")
})

test_that("a colData of the caller's own wins over obs", {
  skip_if_not_installed("SingleCellExperiment")
  skip_if_not_installed("Matrix")
  mine <- data.frame(mine = c("x", "y"), row.names = c("c1", "c2"))

  sce <- seqout_sce(mock_matrix(demo_X(), demo_obs()), colData = mine)

  expect_identical(sce$mine, c("x", "y"))
  expect_false("group" %in% names(SummarizedExperiment::colData(sce)))
})

test_that("empty obs and var are not passed on", {
  skip_if_not_installed("SingleCellExperiment")
  skip_if_not_installed("Matrix")

  sce <- seqout_sce(mock_matrix(demo_X()))

  expect_identical(ncol(SummarizedExperiment::colData(sce)), 0L)
  expect_identical(colnames(sce), c("c1", "c2"))
})

test_that("a series accession is read and bound before SCE conversion", {
  skip_if_not_installed("SingleCellExperiment")
  skip_if_not_installed("Matrix")
  a <- mock_matrix(demo_X(), demo_obs(), demo_var())
  a$sample <- "GSM1"
  b <- mock_matrix(demo_X(), data.frame(kind = c("x", "y"), row.names = c("c1", "c2")), demo_var())
  b$sample <- "GSM2"

  testthat::local_mocked_bindings(
    seqout_counts = function(accession, ...) mock_counts(accession),
    .select_units = function(counts, sample = NULL) list(list(label = "GSM1"), list(label = "GSM2")),
    matrices = function(counts, sample = NULL) list(GSM1 = a, GSM2 = b)
  )

  sce <- seqout_sce("GSE297547", sample = c("GSM1", "GSM2"), max_cells = 1)

  expect_s4_class(sce, "SingleCellExperiment")
  expect_equal(ncol(sce), 2)
  expect_identical(sort(unique(sce$sample)), c("GSM1", "GSM2"))
})

test_that("anything that is neither a matrix nor one accession is rejected", {
  skip_if_not_installed("SingleCellExperiment")

  expect_error(seqout_sce(c("GSM1", "GSM2")), "seqout_matrix")
})
