test_that("seqout_seurat reads a seqout_matrix and carries obs into meta.data", {
  skip_if_not_installed("SeuratObject")
  skip_if_not_installed("Matrix")

  obj <- seqout_seurat(mock_matrix(demo_X(), demo_obs()), project = "demo")

  expect_s4_class(obj, "Seurat")
  expect_equal(dim(obj), c(3, 2))
  expect_identical(unname(obj$group), c("a", "b"))
  expect_identical(obj@project.name, "demo")
})

test_that("a meta.data of the caller's own wins over obs", {
  skip_if_not_installed("SeuratObject")
  skip_if_not_installed("Matrix")
  mine <- data.frame(mine = c("x", "y"), row.names = c("c1", "c2"))

  obj <- seqout_seurat(mock_matrix(demo_X(), demo_obs()), meta.data = mine)

  expect_identical(unname(obj$mine), c("x", "y"))
  expect_false("group" %in% names(obj[[]]))
})

test_that("an empty obs is not passed as meta.data", {
  skip_if_not_installed("SeuratObject")
  skip_if_not_installed("Matrix")

  expect_s4_class(seqout_seurat(mock_matrix(demo_X())), "Seurat")
})

test_that("a series accession is read and bound before Seurat conversion", {
  skip_if_not_installed("SeuratObject")
  skip_if_not_installed("Matrix")
  a <- mock_matrix(demo_X(), demo_obs())
  a$sample <- "GSM1"
  b <- mock_matrix(demo_X(), data.frame(kind = c("x", "y"), row.names = c("c1", "c2")))
  b$sample <- "GSM2"

  testthat::local_mocked_bindings(
    seqout_counts = function(accession, ...) mock_counts(accession),
    .select_units = function(counts, sample = NULL) list(list(label = "GSM1"), list(label = "GSM2")),
    matrices = function(counts, sample = NULL) list(GSM1 = a, GSM2 = b)
  )

  obj <- seqout_seurat("GSE297547", sample = c("GSM1", "GSM2"), max_cells = 1)

  expect_s4_class(obj, "Seurat")
  expect_equal(ncol(obj), 2)
  expect_identical(sort(unique(obj$sample)), c("GSM1", "GSM2"))
})

test_that("anything that is neither a matrix nor one accession is rejected", {
  skip_if_not_installed("SeuratObject")

  expect_error(seqout_seurat(tibble::tibble(unit = "a")), "seqout_matrix")
  expect_error(seqout_seurat(c("GSM1", "GSM2")), "seqout_matrix")
  expect_error(seqout_seurat(NA_character_), "seqout_matrix")
})

test_that("a GSM with no readable matrix says so, and one with several says to pick", {
  skip_if_not_installed("SeuratObject")
  units <- tibble::tibble(unit = c("u1", "u2"), preferred = c(TRUE, TRUE))

  testthat::local_mocked_bindings(seqout_counts = function(...) units[0, ])
  expect_error(seqout_seurat("GSM1"), "no supplementary file")

  testthat::local_mocked_bindings(seqout_counts = function(...) units)
  expect_error(seqout_seurat("GSM1"), "ships 2 matrices")
})
