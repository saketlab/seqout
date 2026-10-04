test_that("country_summary/facets/projects are REST only", {
  expect_error(country_summary("US", con = fake_con()), "REST API")
  expect_error(country_facets("US", con = fake_con()), "REST API")
  expect_error(country_projects("US", con = fake_con()), "REST API")
})

test_that("code is uppercased and trimmed before it reaches the path", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- path
      list(
        studies = 1L, samples = 1L, experiments = 1L, studies_with_fastq = 1L,
        studies_with_sra = 1L, studies_human = 1L, studies_single_cell = 0L,
        studies_long_read = 0L, n_organisms = 1L, first_year = 2020L, last_year = 2024L
      )
    }
  )
  country_summary(" in ", con = rest_con())
  expect_equal(seen, "/country/IN/summary")
})

test_that("a bad country code propagates the server's error", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      cli::cli_abort("API error on {.path {path}}: 'XX' is not a two-letter ISO-3166-1 country code")
    }
  )
  expect_error(country_summary("XX", con = rest_con()), "country code")
})

test_that("facets flatten to one row per value, across facet names", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        organism = list(list(value = "Homo sapiens", studies = 5L)),
        source = list(
          list(value = "geo", studies = 3L),
          list(value = "sra", studies = 2L)
        )
      )
    }
  )
  out <- country_facets("US", con = rest_con())
  expect_equal(nrow(out), 3)
  expect_equal(out$facet, c("organism", "source", "source"))
  expect_equal(out$studies[out$facet == "organism"], 5L)
})

test_that("country_projects pages by the server's offset until total is reached", {
  seen <- mock_pages(two_offset_pages)
  out <- country_projects("US", con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(seen()[[2]]$offset, 1)
  expect_equal(attr(out, "total"), 2)
})

test_that("an empty page stops the walk rather than looping", {
  seen <- mock_pages(list(list(total = 9, count = 0, offset = 0, results = list())))
  out <- country_projects("US", con = rest_con())
  expect_equal(nrow(out), 0)
  expect_length(seen(), 1)
})

test_that("limit cuts the result and the request", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(...)
      list(
        total = 99, count = 3, offset = 0,
        results = list(
          list(study_accession = "GSE1"),
          list(study_accession = "GSE2"),
          list(study_accession = "GSE3")
        )
      )
    }
  )
  out <- country_projects("US", limit = 3, con = rest_con())
  expect_equal(nrow(out), 3)
  expect_equal(seen$limit, 3)
})

test_that("boolean filters reach the server as lowercase strings", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(...)
      list(total = 0, count = 0, offset = 0, results = list())
    }
  )
  country_projects("US", has_fastq = TRUE, is_single_cell = FALSE, con = rest_con())
  expect_equal(seen$has_fastq, "true")
  expect_equal(seen$is_single_cell, "false")
})

test_that("no studies is an empty tibble with the full column set, not an error", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) list(total = 0, count = 0, offset = 0, results = list())
  )
  out <- country_projects("US", con = rest_con())
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.country_project_spec()))
})
