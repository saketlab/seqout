# Check single-cell filtering when assay_is_single_cell is NA.
# Flag filtering excludes unscored samples.

cohort_rows <- function() {
  list(
    list(
      sample = "S1", assay = "snRNA-Seq",
      assay_ontology_name = "single nucleus RNA sequencing",
      assay_is_single_cell = NULL
    ),
    list(
      sample = "S2", assay = "scRNA-Seq",
      assay_ontology_name = "single-cell RNA sequencing",
      assay_is_single_cell = TRUE
    ),
    list(
      sample = "S3", assay = "RNA-Seq",
      assay_ontology_name = "RNA sequencing",
      assay_is_single_cell = NULL
    ),
    list(
      sample = "S4", assay = "WGS",
      assay_ontology_name = "whole genome sequencing",
      assay_is_single_cell = FALSE
    )
  )
}

mock_cohort <- function(rows = cohort_rows()) {
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      keep <- if (isTRUE(args$single_cell_only)) {
        Filter(function(r) isTRUE(r$assay_is_single_cell), rows)
      } else {
        rows
      }
      list(
        samples = keep, total = length(keep), next_offset = NULL,
        filters = list()
      )
    },
    .env = parent.frame()
  )
}

api <- function() fake_con(backend = "api")

test_that("the assay route finds samples the flag never scored", {
  mock_cohort()
  out <- sample_search(tissue = "liver", single_cell = "assay", con = api())
  expect_setequal(out$sample, c("S1", "S2"))
})

test_that("the flag route matches what single_cell_only would return", {
  mock_cohort()
  a <- suppressWarnings(
    sample_search(tissue = "liver", single_cell = "flag", con = api())
  )
  b <- suppressWarnings(
    sample_search(tissue = "liver", single_cell_only = TRUE, con = api())
  )
  expect_equal(a$sample, b$sample)
  expect_equal(a$sample, "S2")
})

test_that("either accepts a sample that passes one test or the other", {
  mock_cohort()
  out <- sample_search(tissue = "liver", single_cell = "either", con = api())
  expect_setequal(out$sample, c("S1", "S2"))
})

test_that("no single_cell argument filters nothing", {
  mock_cohort()
  out <- sample_search(tissue = "liver", con = api())
  expect_equal(nrow(out), 4)
})

test_that("single_cell_only warns even though the result looks clean", {
  # Unscored samples are absent from responses, so warn at request time.
  rlang::reset_warning_verbosity("seqout_single_cell_only_unscored")
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      list(samples = list(
        list(sample = "S1", assay = "scRNA-Seq", assay_is_single_cell = TRUE)
      ), total = 1, next_offset = NULL, filters = list())
    }
  )
  out <- expect_warning(
    sample_search(tissue = "liver", single_cell_only = TRUE, con = api()),
    "assay_is_single_cell"
  )
  expect_false(anyNA(out$assay_is_single_cell))
})

test_that("single_cell = 'flag' warns too, being the same filter", {
  rlang::reset_warning_verbosity("seqout_single_cell_only_unscored")
  mock_cohort()
  expect_warning(
    sample_search(tissue = "liver", single_cell = "flag", con = api()),
    "assay_is_single_cell"
  )
})

test_that("the assay route does not warn", {
  rlang::reset_warning_verbosity("seqout_single_cell_only_unscored")
  mock_cohort()
  expect_no_warning(
    sample_search(tissue = "liver", single_cell = "assay", con = api())
  )
})

test_that("the two ways of asking cannot be combined", {
  expect_error(
    sample_search(
      tissue = "liver", single_cell = "assay",
      single_cell_only = TRUE, con = api()
    ),
    "not both"
  )
})

test_that("an unknown single_cell value is refused", {
  expect_error(
    sample_search(tissue = "liver", single_cell = "assays", con = api()),
    "arg"
  )
})

test_that("filtering keeps the total and filters attributes", {
  mock_cohort()
  out <- sample_search(tissue = "liver", single_cell = "assay", con = api())
  expect_false(is.null(attr(out, "total")))
  expect_false(is.null(attr(out, "filters")))
})
