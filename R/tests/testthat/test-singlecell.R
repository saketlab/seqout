test_that("singlecell_summary/facets/projects are REST only", {
  expect_error(singlecell_summary(con = fake_con()), "REST API")
  expect_error(singlecell_facets(con = fake_con()), "REST API")
  expect_error(singlecell_projects(con = fake_con()), "REST API")
})

test_that("summary hits the corpus-wide path with no path parameter", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- path
      list(
        studies = 1L, samples = 1L, cells = 1, studies_with_matrix = 1L,
        studies_with_fastq = 1L, studies_long_read = 0L,
        studies_with_perturbation = 0L, studies_human = 1L, n_modalities = 1L,
        first_year = 2020L, last_year = 2024L
      )
    }
  )
  out <- singlecell_summary(con = rest_con())
  expect_equal(seen, "/single-cell/summary")
  # corpus-wide cell sums can pass 2^31
  expect_true(is.double(out$cells))
})

test_that("facets flatten to one row per value, across facet names", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        chemistry = list(list(value = "10x Chromium 3' v3", studies = 100L)),
        modality = list(
          list(value = "scRNA-seq", studies = 80L),
          list(value = "snRNA-seq", studies = 20L)
        )
      )
    }
  )
  out <- singlecell_facets(con = rest_con())
  expect_equal(nrow(out), 3)
  expect_equal(out$facet, c("chemistry", "modality", "modality"))
})

test_that("singlecell_projects pages by the server's offset until total is reached", {
  mock_pages(two_offset_pages)
  out <- singlecell_projects(con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(attr(out, "total"), 2)
})

test_that("n_cells stays numeric, not integer, through the record spec", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        total = 1, count = 1, offset = 0,
        results = list(list(study_accession = "GSE1", n_cells = 3e9))
      )
    }
  )
  out <- singlecell_projects(con = rest_con())
  expect_equal(out$n_cells, 3e9)
})

test_that("boolean filters and modality reach the server as-is/lowercase", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(...)
      list(total = 0, count = 0, offset = 0, results = list())
    }
  )
  singlecell_projects(modality = "scRNA-seq", has_matrix = TRUE, is_long_read = FALSE, con = rest_con())
  expect_equal(seen$modality, "scRNA-seq")
  expect_equal(seen$has_matrix, "true")
  expect_equal(seen$is_long_read, "false")
})

test_that("no studies is an empty tibble with the full column set, not an error", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) list(total = 0, count = 0, offset = 0, results = list())
  )
  out <- singlecell_projects(con = rest_con())
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.sc_project_spec()))
})
