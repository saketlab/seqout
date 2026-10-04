test_that("tissue_summary/facets/projects are REST only", {
  expect_error(tissue_summary("liver", con = fake_con()), "REST API")
  expect_error(tissue_facets("liver", con = fake_con()), "REST API")
  expect_error(tissue_projects("liver", con = fake_con()), "REST API")
})

test_that("the term is percent-encoded into the path", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- path
      list(
        studies = 1L, samples = 1L, experiments = 1L, matched_samples = 1L,
        studies_with_fastq = 1L, studies_with_sra = 1L, studies_human = 1L,
        studies_single_cell = 0L, studies_long_read = 0L, n_organisms = 1L,
        first_date = "2020-01-01", last_date = "2024-01-01",
        term = "fatty liver", resolution = "exact", matched_labels = list("liver")
      )
    }
  )
  tissue_summary("fatty liver", con = rest_con())
  expect_equal(seen, "/tissue/fatty%20liver/summary")
})

test_that("resolution and matched_labels ride along on the summary row", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        studies = 1L, samples = 1L, experiments = 1L, matched_samples = 1L,
        studies_with_fastq = 1L, studies_with_sra = 1L, studies_human = 1L,
        studies_single_cell = 0L, studies_long_read = 0L, n_organisms = 1L,
        first_date = "2020-01-01", last_date = "2024-01-01",
        term = "liver", resolution = "substring", matched_labels = list("liver", "fatty liver")
      )
    }
  )
  out <- tissue_summary("liver", con = rest_con())
  expect_equal(out$resolution, "substring")
  expect_equal(out$matched_labels[[1]], c("liver", "fatty liver"))
})

test_that("facets flatten to one row per value, across facet names", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        organism = list(list(value = "Homo sapiens", studies = 5L)),
        source = list(list(value = "geo", studies = 3L))
      )
    }
  )
  out <- tissue_facets("liver", con = rest_con())
  expect_equal(nrow(out), 2)
  expect_equal(out$facet, c("organism", "source"))
})

test_that("tissue_projects has no offset argument; it paginates by cursor", {
  expect_false("offset" %in% names(formals(tissue_projects)))
})

test_that("tissue_projects walks next_cursor until it comes back null", {
  seen <- mock_pages(list(
    list(
      total = 2, count = 1,
      results = list(list(study_accession = "GSE1", n_samples_with_tissue = 3L)),
      next_cursor = list(sort_value = "2024-01-01", accession = "GSE1")
    ),
    list(
      total = 2, count = 1,
      results = list(list(study_accession = "GSE2", n_samples_with_tissue = 5L)),
      next_cursor = NULL
    )
  ))
  out <- tissue_projects("liver", con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(out$n_samples_with_tissue, c(3L, 5L))
  expect_equal(attr(out, "total"), 2)
  # first page carries no cursor; the second page replays what the first returned
  expect_null(seen()[[1]]$cursor_sort)
  expect_null(seen()[[1]]$cursor_acc)
  expect_equal(seen()[[2]]$cursor_sort, "2024-01-01")
  expect_equal(seen()[[2]]$cursor_acc, "GSE1")
})

test_that("a non-null next_cursor stops mattering once limit is met", {
  calls <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      calls <<- calls + 1
      list(
        total = 99, count = 2,
        results = list(
          list(study_accession = "GSE1"),
          list(study_accession = "GSE2")
        ),
        next_cursor = list(sort_value = "x", accession = "GSE2")
      )
    }
  )
  out <- tissue_projects("liver", limit = 2, con = rest_con())
  expect_equal(nrow(out), 2)
  expect_equal(calls, 1)
})

test_that("boolean filters reach the server as lowercase strings", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(...)
      list(total = 0, count = 0, results = list(), next_cursor = NULL)
    }
  )
  tissue_projects("liver", has_fastq = TRUE, is_long_read = FALSE, con = rest_con())
  expect_equal(seen$has_fastq, "true")
  expect_equal(seen$is_long_read, "false")
})

test_that("a term with no UBERON match propagates the server's 404", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      cli::cli_abort("API error on {.path {path}}: 'zzz' does not match any UBERON tissue term.")
    }
  )
  expect_error(tissue_summary("zzz", con = rest_con()), "UBERON")
})

test_that("no studies is an empty tibble with the full column set, not an error", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) list(total = 0, count = 0, results = list(), next_cursor = NULL)
  )
  out <- tissue_projects("liver", con = rest_con())
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.ot_project_spec("n_samples_with_tissue")))
})
