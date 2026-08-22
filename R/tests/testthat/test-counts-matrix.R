mock_matrix <- function(X) {
  structure(
    list(
      X = X,
      obs = data.frame(row.names = colnames(X)),
      var = data.frame(row.names = rownames(X))
    ),
    class = "seqout_matrix"
  )
}

test_that("bind_counts intersects features and binds genes by cells", {
  a <- mock_matrix(matrix(1:6,
    nrow = 3,
    dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))
  ))
  b <- mock_matrix(matrix(1:4,
    nrow = 2,
    dimnames = list(c("g2", "g3"), c("c1", "c2"))
  ))

  out <- bind_counts(list(early = a, late = b))

  expect_identical(rownames(out), c("g2", "g3"))
  expect_identical(colnames(out), c("early_c1", "early_c2", "late_c1", "late_c2"))
  expect_identical(out["g2", "late_c1"], 1L)
  expect_identical(out["g2", "early_c1"], 2L)
})

test_that("bind_counts keeps sparse inputs sparse", {
  skip_if_not_installed("Matrix")
  X <- Matrix::Matrix(1:6, nrow = 3, ncol = 2, sparse = TRUE)
  dimnames(X) <- list(c("g1", "g2", "g3"), c("c1", "c2"))

  out <- bind_counts(list(a = mock_matrix(X), b = mock_matrix(X)))

  expect_s4_class(out, "dgCMatrix")
  expect_identical(dim(out), c(3L, 4L))
})

test_that("max_cells caps columns per matrix", {
  X <- matrix(1:9,
    nrow = 3,
    dimnames = list(c("g1", "g2", "g3"), c("c1", "c2", "c3"))
  )
  set.seed(1)

  out <- bind_counts(list(a = mock_matrix(X), b = mock_matrix(X)), max_cells = 2)

  expect_identical(dim(out), c(3L, 4L))
  expect_identical(sub("_.*$", "", colnames(out)), c("a", "a", "b", "b"))
})

test_that("bind_counts labels default to integers when the list is unnamed", {
  X <- matrix(1:4, nrow = 2, dimnames = list(c("g1", "g2"), c("c1", "c2")))

  out <- bind_counts(list(mock_matrix(X), mock_matrix(X)))

  expect_identical(colnames(out), c("1_c1", "1_c2", "2_c1", "2_c2"))
})

test_that("bind_counts falls back to an index when cells are unnamed", {
  X <- matrix(1:4, nrow = 2, dimnames = list(c("g1", "g2"), NULL))

  out <- bind_counts(list(a = mock_matrix(X)))

  expect_identical(colnames(out), c("a_1", "a_2"))
})

test_that("bind_counts rejects empty input and disjoint features", {
  a <- mock_matrix(matrix(1:2, nrow = 2, dimnames = list(c("g1", "g2"), "c1")))
  b <- mock_matrix(matrix(1:2, nrow = 2, dimnames = list(c("g8", "g9"), "c1")))

  expect_error(bind_counts(list(a, b)), "share no features")
  expect_error(bind_counts(list()), "non-empty list")
})
