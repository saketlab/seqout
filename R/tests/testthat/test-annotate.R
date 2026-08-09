expr <- function() {
  m <- matrix(0,
    nrow = 4, ncol = 6,
    dimnames = list(c("Neurod2", "Tbr1", "Cx3cr1", "C1qa"), paste0("c", 1:6))
  )
  m[c("Neurod2", "Tbr1"), 1:3] <- 5
  m[c("Cx3cr1", "C1qa"), 4:6] <- 5
  m
}

markers <- list(
  neuron = c("Neurod2", "Tbr1", "Satb2"),
  microglia = c("Cx3cr1", "C1qa")
)

test_that("each cluster takes its highest-scoring marker set", {
  out <- quick_annotation(expr(), c("a", "a", "a", "b", "b", "b"), markers)

  expect_identical(out[["a"]], "neuron")
  expect_identical(out[["b"]], "microglia")
  expect_identical(names(out), c("a", "b"))
})

test_that("cluster order follows factor levels", {
  clusters <- factor(rep(c("10", "2"), each = 3), levels = c("10", "2"))

  out <- quick_annotation(expr(), clusters, markers, normalize = FALSE)

  expect_identical(names(out), c("10", "2"))
  expect_identical(as.character(out), c("neuron", "microglia"))
  expect_identical(dim(attr(out, "scores")), c(2L, 2L))
  expect_identical(attr(out, "scores")["10", "neuron"], 5)
})

test_that("raw counts are normalised, so depth does not decide the label", {
  m <- expr()
  m[, 1] <- m[, 1] * 100
  clusters <- rep(c("a", "b"), each = 3)

  scores <- attr(quick_annotation(m, clusters, markers), "scores")
  raw <- attr(quick_annotation(m, clusters, markers, normalize = FALSE), "scores")

  expect_lt(scores["a", "neuron"], 10)
  expect_gt(raw["a", "neuron"], 100)
  expect_identical(scores["a", "microglia"], 0)
})

test_that("input that is not whole numbers is left alone", {
  scores <- attr(quick_annotation(expr() / 3, rep("a", 6), markers), "scores")

  expect_equal(scores["a", "neuron"], 5 / 6, tolerance = 1e-12)
})

test_that("marker sets absent from the matrix are dropped", {
  m <- expr()

  expect_warning(
    out <- quick_annotation(m, rep("a", 6), c(markers, list(oligo = "Pdgfra"))),
    "oligo"
  )
  expect_identical(colnames(attr(out, "scores")), c("neuron", "microglia"))
  expect_error(
    suppressWarnings(quick_annotation(m, rep("a", 6), list(oligo = "Pdgfra"))),
    "None of the marker genes"
  )
})

test_that("a cluster vector that does not match the matrix is an error", {
  expect_error(quick_annotation(expr(), rep("a", 5), markers), "5 entries")
  expect_error(quick_annotation(expr(), rep("a", 6), list("Tbr1")), "named list")
})

test_that("sparse input works", {
  skip_if_not_installed("Matrix")
  m <- Matrix::Matrix(expr(), sparse = TRUE)

  out <- quick_annotation(m, rep(c("a", "b"), each = 3), markers)

  expect_identical(as.character(out), c("neuron", "microglia"))
})
