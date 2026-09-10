chem_records <- list(
  list(
    run_accession = "SRR1", study_accession = "SRP1",
    instrument_platform = "OXFORD_NANOPORE", instrument_model = "PromethION",
    chemistry = "R10.4.1", chemistry_confidence = "exact",
    chemistry_source = "bam_header", ont_pore = "R10.4.1", ont_kit = "SQK-LSK114"
  ),
  list(
    run_accession = "SRR2", instrument_platform = "PACBIO_SMRT",
    instrument_model = "Sequel II", chemistry_confidence = "bucket"
  )
)

test_that("chemistry rows carry the confidence tier", {
  out <- seqout:::.pnt_tibble(chem_records, seqout:::.lr_chem_spec())
  expect_equal(out$run_accession, c("SRR1", "SRR2"))
  expect_equal(out$chemistry_confidence, c("exact", "bucket"))
  expect_true(is.na(out$study_accession[2]))
})

test_that("no runs still gives the full set of typed columns", {
  out <- seqout:::.pnt_tibble(list(), seqout:::.lr_chem_spec())
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.lr_chem_spec()))
})

test_that("longread_summary and longread_facets are REST only", {
  expect_error(longread_summary(con = fake_con()), "REST API")
  expect_error(longread_facets(con = fake_con()), "REST API")
  expect_error(longread_projects(con = fake_con()), "REST API")
  expect_error(project_longread_chemistry("GSE1", con = fake_con()), "REST API")
})

test_that("facets flatten to one row per value, across facet names", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        technology = list(list(value = "PacBio", studies = 4L)),
        organism = list(
          list(value = "Homo sapiens", studies = 3L),
          list(value = "Mus musculus", studies = 1L)
        )
      )
    }
  )
  out <- longread_facets(con = rest_con())
  expect_equal(nrow(out), 3)
  expect_equal(out$facet, c("technology", "organism", "organism"))
  expect_equal(out$studies[out$facet == "technology"], 4L)
})

test_that("longread_projects pages by the server's offset until total is reached", {
  seen <- list()
  page <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      page <<- page + 1
      seen[[page]] <<- list(...)
      if (page == 1) {
        list(
          total = 2, count = 1, offset = 0,
          results = list(list(study_accession = "GSE1", is_single_cell = FALSE))
        )
      } else {
        list(
          total = 2, count = 1, offset = 1,
          results = list(list(study_accession = "GSE2", is_single_cell = TRUE))
        )
      }
    }
  )
  out <- longread_projects(con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(seen[[2]]$offset, 1)
  expect_equal(attr(out, "total"), 2)
})

test_that("an empty page stops the walk rather than looping", {
  page <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      page <<- page + 1
      list(total = 9, count = 0, offset = 0, results = list())
    }
  )
  out <- longread_projects(con = rest_con())
  expect_equal(nrow(out), 0)
  expect_equal(page, 1)
})

test_that("single_cell filters locally and reads every page", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      dots <- list(...)
      expect_null(dots$single_cell) # no such server-side parameter
      if (identical(dots$offset, 0)) {
        list(
          total = 2, count = 1, offset = 0,
          results = list(list(study_accession = "GSE1", is_single_cell = FALSE))
        )
      } else {
        list(
          total = 2, count = 1, offset = 1,
          results = list(list(study_accession = "GSE2", is_single_cell = TRUE))
        )
      }
    }
  )
  out <- longread_projects(single_cell = TRUE, con = rest_con())
  expect_equal(out$study_accession, "GSE2")
})

test_that("single_cell with limit stops once limit is met", {
  # Stop once enough sorted rows survive the local filter.
  calls <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      calls <<- calls + 1
      list(
        total = 3, count = 2, offset = 0,
        results = list(
          list(study_accession = "GSE1", is_single_cell = TRUE),
          list(study_accession = "GSE2", is_single_cell = TRUE)
        )
      )
    }
  )
  out <- longread_projects(single_cell = TRUE, limit = 2, con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(calls, 1)
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
  out <- longread_projects(limit = 3, con = rest_con())
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
  longread_projects(long_read_only = TRUE, has_fastq = FALSE, con = rest_con())
  expect_equal(seen$long_read_only, "true")
  expect_equal(seen$has_fastq, "false")
})

test_that("project_longread_chemistry reads the resolved study's runs", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      expect_match(path, "/project/GSE1/longread-chemistry")
      list(accession = "GSE1", runs = chem_records)
    }
  )
  out <- project_longread_chemistry("gse1", con = rest_con())
  expect_equal(out$run_accession, c("SRR1", "SRR2"))
})

test_that("no long-read runs is an empty tibble, not an error", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) list(accession = "GSE1", runs = list())
  )
  out <- project_longread_chemistry("GSE1", con = rest_con())
  expect_equal(nrow(out), 0)
})

test_that("seqout_search accepts long_read as a filter", {
  seen <- list()
  testthat::local_mocked_bindings(
    .paginate_api = function(con, path, params, max_pages = 1) {
      seen[[length(seen) + 1]] <<- params
      tibble::tibble()
    }
  )
  seqout_search("liver fibrosis", long_read = TRUE, con = rest_con())
  expect_equal(seen[[1]]$long_read, "true")
})
