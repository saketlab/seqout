mock_matrix <- function(X, obs = data.frame(row.names = colnames(X))) {
  structure(
    list(X = X, obs = obs, var = data.frame(row.names = rownames(X))),
    class = "seqout_matrix"
  )
}

# sparse, as real counts are, and so Seurat does not warn about coercing
demo_X <- function() {
  X <- Matrix::Matrix(1:6, nrow = 3, ncol = 2, sparse = TRUE)
  dimnames(X) <- list(c("g1", "g2", "g3"), c("c1", "c2"))
  X
}

demo_obs <- function() {
  data.frame(group = c("a", "b"), row.names = c("c1", "c2"))
}

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

test_that("a series accession says which two functions to use instead", {
  skip_if_not_installed("SeuratObject")

  expect_error(seqout_seurat("GSE297547"), "not a GSM accession")
})

test_that("anything that is neither a matrix nor one accession is rejected", {
  skip_if_not_installed("SeuratObject")

  expect_error(seqout_seurat(tibble::tibble(unit = "a")), "one GSM accession")
  expect_error(seqout_seurat(c("GSM1", "GSM2")), "one GSM accession")
  expect_error(seqout_seurat(NA_character_), "one GSM accession")
})

test_that("a GSM with no readable matrix says so, and one with several says to pick", {
  skip_if_not_installed("SeuratObject")
  units <- tibble::tibble(unit = c("u1", "u2"), preferred = c(TRUE, TRUE))

  testthat::local_mocked_bindings(seqout_counts = function(...) units[0, ])
  expect_error(seqout_seurat("GSM1"), "no supplementary file")

  testthat::local_mocked_bindings(seqout_counts = function(...) units)
  expect_error(seqout_seurat("GSM1"), "ships 2 matrices")
})
