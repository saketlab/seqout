test_that("bind_counts intersects features and binds genes by cells", {
  a <- mock_matrix(matrix(1:6,
    nrow = 3,
    dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))
  ))
  b <- mock_matrix(matrix(1:4,
    nrow = 2,
    dimnames = list(c("g2", "g3"), c("c1", "c2"))
  ))

  expect_warning(
    out <- bind_counts(list(early = a, late = b)),
    "do not share a feature space"
  )

  expect_identical(rownames(out), c("g2", "g3"))
  expect_identical(colnames(out), c("early_c1", "early_c2", "late_c1", "late_c2"))
  expect_identical(out["g2", "late_c1"], 1L)
  expect_identical(out["g2", "early_c1"], 2L)
  expect_false(inherits(out, "seqout_matrix"))
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


test_that(".bind_units preserves observation metadata across units", {
  a <- mock_matrix(
    matrix(1:6, nrow = 3, dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))),
    obs = data.frame(batch = c("a", "b"), row.names = c("c1", "c2")),
    var = data.frame(symbol = c("A", "B", "C"), row.names = c("g1", "g2", "g3"))
  )
  a$sample <- "GSM1"
  b <- mock_matrix(
    matrix(1:6, nrow = 3, dimnames = list(c("g2", "g3", "g4"), c("c1", "c3"))),
    obs = data.frame(donor = c("D1", "D2"), row.names = c("c1", "c3")),
    var = data.frame(symbol = c("B", "C", "D"), row.names = c("g2", "g3", "g4"))
  )
  b$sample <- "GSM2"

  expect_warning(
    out <- .bind_units(list(a = a, b = b), labels = c("GSM1", "GSM2")),
    "do not share a feature space"
  )

  expect_s3_class(out, "seqout_matrix")
  expect_identical(rownames(out$X), c("g2", "g3"))
  expect_identical(colnames(out$X), c("GSM1_c1", "GSM1_c2", "GSM2_c1", "GSM2_c3"))
  expect_identical(rownames(out$obs), colnames(out$X))
  expect_identical(out$obs$sample, c("GSM1", "GSM1", "GSM2", "GSM2"))
  expect_identical(out$obs$batch, c("a", "b", NA, NA))
  expect_identical(out$obs$donor, c(NA, NA, "D1", "D2"))
  expect_identical(rownames(out$var), c("g2", "g3"))
  expect_identical(out$var$symbol, c("B", "C"))
})

test_that(".bind_units uses unit labels when no GSM sample exists", {
  X <- matrix(1:4, nrow = 2, dimnames = list(c("g1", "g2"), c("c1", "c2")))

  out <- .bind_units(list(unit_a = mock_matrix(X)), labels = "unit_a")

  expect_identical(out$obs$sample, c("unit_a", "unit_a"))
})

test_that(".bind_units makes duplicate prefixed cell names unique", {
  X <- matrix(1:4, nrow = 2, dimnames = list(c("g1", "g2"), c("c1", "c2")))
  a <- mock_matrix(X)
  a$sample <- "GSM1"

  out <- .bind_units(list(a, a), labels = c("GSM1", "GSM1"))

  expect_identical(anyDuplicated(colnames(out$X)), 0L)
  expect_identical(rownames(out$obs), colnames(out$X))
  expect_true(all(startsWith(colnames(out$X), "GSM1_")))
})

test_that(".as_seqout_matrix reads a GSE through matrices", {
  seen <- new.env(parent = emptyenv())
  a <- mock_matrix(demo_X(), demo_obs())
  a$sample <- "GSM1"
  b <- mock_matrix(demo_X(), data.frame(kind = c("x", "y"), row.names = c("c1", "c2")))
  b$sample <- "GSM2"

  testthat::local_mocked_bindings(
    seqout_counts = function(accession, ...) {
      seen$accession <- accession
      mock_counts(accession)
    },
    .select_units = function(counts, sample = NULL) {
      seen$selected <- sample
      list(list(label = "GSM1"), list(label = "GSM2"))
    },
    matrices = function(counts, sample = NULL) {
      seen$matrices_sample <- sample
      list(GSM1 = a, GSM2 = b)
    }
  )

  out <- .as_seqout_matrix("GSE297547", sample = c("GSM1", "GSM2"))

  expect_s3_class(out, "seqout_matrix")
  expect_identical(seen$accession, "GSE297547")
  expect_identical(seen$selected, c("GSM1", "GSM2"))
  expect_identical(seen$matrices_sample, c("GSM1", "GSM2"))
  expect_identical(out$obs$sample, c("GSM1", "GSM1", "GSM2", "GSM2"))
})

test_that(".as_seqout_matrix accepts a seqout_counts table", {
  counts <- mock_counts("GSE297547")
  a <- mock_matrix(demo_X(), demo_obs())
  a$sample <- "GSM1"

  testthat::local_mocked_bindings(
    .select_units = function(counts, sample = NULL) list(list(label = "GSM1")),
    matrices = function(counts, sample = NULL) list(GSM1 = a)
  )

  out <- .as_seqout_matrix(counts, sample = "GSM1")

  expect_s3_class(out, "seqout_matrix")
  expect_identical(out$obs$sample, c("GSM1", "GSM1"))
})

test_that("bind_counts names what an inner join would drop", {
  a <- mock_matrix(matrix(1:6,
    nrow = 3,
    dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))
  ))
  b <- mock_matrix(matrix(1:4,
    nrow = 2,
    dimnames = list(c("g2", "g3"), c("c1", "c2"))
  ))

  expect_warning(bind_counts(list(early = a, late = b)), "early loses 1")
  expect_error(
    bind_counts(list(early = a, late = b), strict = TRUE),
    "do not share a feature space"
  )
})

test_that("bind_counts is quiet when the feature sets match", {
  X <- demo_X()
  expect_silent(out <- bind_counts(list(a = mock_matrix(X), b = mock_matrix(X)),
    strict = TRUE
  ))
  expect_identical(rownames(out), rownames(X))
})

test_that('join = "outer" keeps the union and fills absent features with zero', {
  a <- mock_matrix(matrix(1:6,
    nrow = 3,
    dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))
  ))
  b <- mock_matrix(matrix(7:12,
    nrow = 3,
    dimnames = list(c("g2", "g3", "g4"), c("c1", "c2"))
  ))

  # nothing is dropped, so nothing is warned about
  expect_silent(out <- bind_counts(list(A = a, B = b), join = "outer"))

  expect_identical(rownames(out), c("g1", "g2", "g3", "g4"))
  expect_identical(out["g4", c("A_c1", "A_c2")], c(A_c1 = 0L, A_c2 = 0L))
  expect_identical(out["g1", c("B_c1", "B_c2")], c(B_c1 = 0L, B_c2 = 0L))
  expect_identical(out["g2", "B_c1"], 7L)
  expect_false(anyNA(out))
})

test_that('join = "outer" keeps sparse inputs sparse', {
  a <- mock_matrix(Matrix::Matrix(
    matrix(1:6, nrow = 3, dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))),
    sparse = TRUE
  ))
  b <- mock_matrix(Matrix::Matrix(
    matrix(7:12, nrow = 3, dimnames = list(c("g2", "g3", "g4"), c("c1", "c2"))),
    sparse = TRUE
  ))

  out <- bind_counts(list(A = a, B = b), join = "outer")

  expect_s4_class(out, "dgCMatrix")
  expect_identical(rownames(out), c("g1", "g2", "g3", "g4"))
  expect_equal(as.vector(out["g4", ]), c(0, 0, 9, 12))
})

test_that('join = "outer" binds matrices with no shared features', {
  a <- mock_matrix(matrix(1:2, nrow = 2, dimnames = list(c("g1", "g2"), "c1")))
  b <- mock_matrix(matrix(3:4, nrow = 2, dimnames = list(c("g3", "g4"), "c1")))

  expect_error(bind_counts(list(A = a, B = b)), "share no features")
  out <- bind_counts(list(A = a, B = b), join = "outer")
  expect_identical(rownames(out), c("g1", "g2", "g3", "g4"))
  expect_identical(dim(out), c(4L, 2L))
})

test_that('join = "outer" leaves a small dense bind dense', {
  a <- mock_matrix(matrix(1:6,
    nrow = 3, dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))
  ))
  b <- mock_matrix(matrix(7:12,
    nrow = 3, dimnames = list(c("g2", "g3", "g4"), c("c1", "c2"))
  ))

  out <- bind_counts(list(A = a, B = b), join = "outer")

  expect_true(is.matrix(out))
  expect_type(out, "integer")
})

test_that('join = "outer" goes sparse rather than allocating a huge dense block', {
  skip_if_not_installed("Matrix")
  # Disjoint dense units make the union exceed the dense limit.
  units <- lapply(seq_len(25), function(k) {
    mock_matrix(matrix(0L,
      nrow = 3000, ncol = 40,
      dimnames = list(paste0("u", k, "_g", seq_len(3000)), paste0("c", seq_len(40)))
    ))
  })
  names(units) <- paste0("U", seq_len(25))

  expect_message(
    out <- bind_counts(units, join = "outer"),
    "as a sparse matrix"
  )

  expect_s4_class(out, "dgCMatrix")
  expect_identical(dim(out), c(75000L, 1000L))
})

test_that("bind_counts mixes dense and sparse inputs", {
  skip_if_not_installed("Matrix")
  a <- mock_matrix(matrix(1:6,
    nrow = 3, dimnames = list(c("g1", "g2", "g3"), c("c1", "c2"))
  ))
  b <- mock_matrix(Matrix::Matrix(
    matrix(7:12, nrow = 3, dimnames = list(c("g2", "g3", "g4"), c("c1", "c2"))),
    sparse = TRUE
  ))

  out <- bind_counts(list(A = a, B = b), join = "outer")

  expect_identical(rownames(out), c("g1", "g2", "g3", "g4"))
  expect_equal(as.vector(out["g1", ]), c(1, 4, 0, 0))
})
