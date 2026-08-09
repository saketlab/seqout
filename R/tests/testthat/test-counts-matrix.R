mock_matrix <- function(X) {
  structure(
    list(
      X = X,
      obs = data.frame(row.names = c("cell1", "cell2")),
      var = data.frame(row.names = c("g1", "g2", "g3"))
    ),
    class = "seqout_matrix"
  )
}

test_that("counts_matrix flips a sparse matrix to genes by cells", {
  skip_if_not_installed("Matrix")
  X <- Matrix::Matrix(1:6, nrow = 2, ncol = 3, sparse = TRUE)
  dimnames(X) <- list(c("cell1", "cell2"), c("g1", "g2", "g3"))

  out <- counts_matrix(mock_matrix(X))

  expect_s4_class(out, "Matrix")
  expect_identical(dim(out), c(3L, 2L))
  expect_identical(rownames(out), c("g1", "g2", "g3"))
  expect_identical(colnames(out), c("cell1", "cell2"))
})

test_that("counts_matrix handles a dense matrix", {
  X <- matrix(1:6, nrow = 2, dimnames = list(c("cell1", "cell2"), c("g1", "g2", "g3")))

  out <- counts_matrix(mock_matrix(X))

  expect_true(is.matrix(out))
  expect_identical(dim(out), c(3L, 2L))
  expect_identical(out["g2", "cell1"], 3L)
})

test_that("counts_matrix rejects anything else", {
  expect_error(counts_matrix(matrix(1:4, 2)), "seqout_matrix")
})

test_that("the orientation aliases disagree only on orientation", {
  skip_if_not_installed("Matrix")
  X <- Matrix::Matrix(1:6, nrow = 2, ncol = 3, sparse = TRUE)
  dimnames(X) <- list(c("cell1", "cell2"), c("g1", "g2", "g3"))
  m <- mock_matrix(X)

  expect_identical(genexcell_counts(m), counts_matrix(m))
  expect_identical(cellxgene_counts(m), X)
  expect_identical(dim(cellxgene_counts(m)), rev(dim(genexcell_counts(m))))
  expect_s4_class(cellxgene_counts(m), "dgCMatrix")
  expect_s4_class(genexcell_counts(m), "dgCMatrix")
  expect_error(cellxgene_counts(matrix(1:4, 2)), "seqout_matrix")
})

test_that("bind_counts intersects features and binds into one matrix", {
  a <- mock_matrix(matrix(1:6, nrow = 2, dimnames = list(c("c1", "c2"), c("g1", "g2", "g3"))))
  b <- mock_matrix(matrix(1:4, nrow = 2, dimnames = list(c("c1", "c2"), c("g2", "g3"))))

  out <- bind_counts(list(early = a, late = b))

  expect_identical(rownames(out), c("g2", "g3"))
  expect_identical(colnames(out), c("early_c1", "early_c2", "late_c1", "late_c2"))
  expect_identical(out["g2", "late_c1"], 1L)
  expect_identical(out["g2", "early_c1"], 3L)
})

test_that("bind_counts keeps sparse inputs sparse", {
  skip_if_not_installed("Matrix")
  X <- Matrix::Matrix(1:6, nrow = 2, ncol = 3, sparse = TRUE)
  dimnames(X) <- list(c("c1", "c2"), c("g1", "g2", "g3"))
  m <- mock_matrix(X)

  out <- bind_counts(list(a = m, b = m))

  expect_s4_class(out, "dgCMatrix")
  expect_identical(dim(out), c(3L, 4L))
})

test_that("max_cells caps columns per matrix", {
  X <- matrix(1:9, nrow = 3, dimnames = list(c("c1", "c2", "c3"), c("g1", "g2", "g3")))
  set.seed(1)

  out <- bind_counts(list(a = mock_matrix(X), b = mock_matrix(X)), max_cells = 2)

  expect_identical(dim(out), c(3L, 4L))
  expect_identical(sub("_.*$", "", colnames(out)), c("a", "a", "b", "b"))
})

test_that("bind_counts labels default to integers when the list is unnamed", {
  X <- matrix(1:4, nrow = 2, dimnames = list(c("c1", "c2"), c("g1", "g2")))

  out <- bind_counts(list(mock_matrix(X), mock_matrix(X)))

  expect_identical(colnames(out), c("1_c1", "1_c2", "2_c1", "2_c2"))
})

test_that("bind_counts falls back to an index when cells are unnamed", {
  X <- matrix(1:4, nrow = 2, dimnames = list(NULL, c("g1", "g2")))

  out <- bind_counts(list(a = mock_matrix(X)))

  expect_identical(colnames(out), c("a_1", "a_2"))
})

test_that("bind_counts rejects empty input and disjoint features", {
  a <- mock_matrix(matrix(1:2, nrow = 1, dimnames = list("c1", c("g1", "g2"))))
  b <- mock_matrix(matrix(1:2, nrow = 1, dimnames = list("c1", c("g8", "g9"))))

  expect_error(bind_counts(list(a, b)), "share no features")
  expect_error(bind_counts(list()), "non-empty list")
})

test_that("the orientation aliases work on a dense matrix", {
  X <- matrix(1:6, nrow = 2, dimnames = list(c("cell1", "cell2"), c("g1", "g2", "g3")))

  expect_identical(cellxgene_counts(mock_matrix(X)), X)
})
