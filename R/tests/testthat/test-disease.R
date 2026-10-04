test_that("disease_summary/facets/projects are REST only", {
  expect_error(disease_summary("rare", con = fake_con()), "REST API")
  expect_error(disease_facets("rare", con = fake_con()), "REST API")
  expect_error(disease_projects("rare", con = fake_con()), "REST API")
})

test_that("a curated collection is matched case-insensitively and hits /disease/{collection}", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- path
      list(
        studies = 1L, samples = 1L, cells = 1, studies_single_cell = 0L,
        studies_cells_measured = 0L, studies_human = 1L, studies_human_primary = 1L,
        studies_model = 0L, studies_cell_line = 0L, studies_with_ancestry = 0L,
        stated_male = 0L, stated_female = 0L, stated_missing = 1L,
        reads_male = 0L, reads_female = 0L
      )
    }
  )
  disease_summary("RARE", con = rest_con())
  # server lookup is exact-case; canonicalize before the URL too
  expect_equal(seen, "/disease/rare/summary")
})

test_that("a curated summary's cells column is numeric, not integer", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        studies = 1L, samples = 1L, cells = 3682462188, studies_single_cell = 0L,
        studies_cells_measured = 0L, studies_human = 1L, studies_human_primary = 1L,
        studies_model = 0L, studies_cell_line = 0L, studies_with_ancestry = 0L,
        stated_male = 0L, stated_female = 0L, stated_missing = 1L,
        reads_male = 0L, reads_female = 0L
      )
    }
  )
  out <- disease_summary("rare", con = rest_con())
  expect_equal(out$cells, 3682462188)
})

test_that("a non-curated string is treated as a free-text MONDO term", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- path
      list(
        studies = 1L, samples = 1L, experiments = 1L, matched_samples = 1L,
        studies_with_fastq = 1L, studies_with_sra = 1L, studies_human = 1L,
        studies_single_cell = 0L, studies_long_read = 0L, n_organisms = 1L,
        first_date = "2020-01-01", last_date = "2024-01-01",
        term = "fatty liver disease", resolution = "exact", matched_labels = list("fatty liver disease")
      )
    }
  )
  out <- disease_summary("fatty liver disease", con = rest_con())
  expect_match(seen, "^/disease/fatty%20liver%20disease/summary$")
  expect_equal(out$resolution, "exact")
})

test_that("disease_facets dispatches the same way as disease_summary", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(category = list(list(value = "Cancers", studies = 10L)))
    }
  )
  out <- disease_facets("rare", con = rest_con())
  expect_equal(out$facet, "category")

  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(organism = list(list(value = "Homo sapiens", studies = 4L)))
    }
  )
  out <- disease_facets("some free text term", con = rest_con())
  expect_equal(out$facet, "organism")
})

test_that("curated disease_projects sends the curated filter set and default sort", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(path = path, params = list(...))
      list(total = 0, count = 0, offset = 0, results = list())
    }
  )
  disease_projects("rare", category = "Cancers", con = rest_con())
  expect_equal(seen$path, "/disease/rare/projects")
  expect_equal(seen$params$category, "Cancers")
  expect_equal(seen$params$sort, "cells")
  expect_equal(seen$params$scope, "human_primary")
})

test_that("curated disease_projects rows carry the collection's own tag columns", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        total = 1, count = 1, offset = 0,
        results = list(list(
          study_accession = "GSE1", nord_types = list("rare-diseases"),
          catalogue_diseases = list("Huntington's Disease")
        ))
      )
    }
  )
  out <- disease_projects("nord", con = rest_con())
  expect_true("nord_types" %in% names(out))
  expect_false("categories" %in% names(out))
})

test_that("term-mode disease_projects sends the ontology-term filter set and default sort", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(path = path, params = list(...))
      list(total = 0, count = 0, offset = 0, results = list())
    }
  )
  disease_projects("fatty liver disease", organism = "Homo sapiens", con = rest_con())
  expect_match(seen$path, "^/disease/fatty%20liver%20disease/projects$")
  expect_equal(seen$params$organism, "Homo sapiens")
  expect_equal(seen$params$sort, "pub_date")
  expect_null(seen$params$scope)
})

test_that("offset is rejected for a free-text disease term", {
  expect_error(
    disease_projects("fatty liver disease", offset = 5, con = rest_con()),
    "cursor"
  )
  # the curated path still takes offset
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) list(total = 0, count = 0, offset = 0, results = list())
  )
  expect_no_error(disease_projects("rare", offset = 5, con = rest_con()))
})

test_that("term-mode disease_projects walks next_cursor until it comes back null", {
  mock_pages(list(
    list(
      total = 2, count = 1,
      results = list(list(study_accession = "GSE1", n_samples_with_disease = 3L)),
      next_cursor = list(sort_value = "2024-01-01", accession = "GSE1")
    ),
    list(
      total = 2, count = 1,
      results = list(list(study_accession = "GSE2", n_samples_with_disease = 5L)),
      next_cursor = NULL
    )
  ))
  out <- disease_projects("fatty liver disease", con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(out$n_samples_with_disease, c(3L, 5L))
  expect_equal(attr(out, "total"), 2)
})

test_that("an unresolvable term propagates the server's 404", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      cli::cli_abort("API error on {.path {path}}: 'nonsense' is neither a disease collection nor a MONDO term.")
    }
  )
  expect_error(disease_summary("nonsense", con = rest_con()), "MONDO term")
})

test_that("disease_aliases shapes matches and keeps total and truncation", {
  seen <- mock_pages(list(list(
    query = "marfan", total = 21, count = 1, truncated = TRUE,
    results = list(list(
      display_name = "Marfan Syndrome", alias = "marfan syndrome",
      mondo_ids = list("MONDO:0007947"), sources = list("gard", "nord")
    ))
  )))
  out <- disease_aliases("marfan", limit = 1, con = rest_con())
  expect_equal(seen()[[1]]$q, "marfan")
  expect_equal(seen()[[1]]$limit, 1)
  expect_equal(out$display_name, "Marfan Syndrome")
  expect_equal(out$sources[[1]], c("gard", "nord"))
  expect_equal(attr(out, "total"), 21)
  expect_true(attr(out, "truncated"))
})

test_that("disease_aliases is REST only", {
  expect_error(disease_aliases("marfan", con = fake_con()), "REST API")
})
