test_that("perturbation_summary/facets/projects are REST only", {
  expect_error(perturbation_summary(con = fake_con()), "REST API")
  expect_error(perturbation_facets(con = fake_con()), "REST API")
  expect_error(perturbation_projects(con = fake_con()), "REST API")
})

test_that("summary hits the corpus-wide path and keeps cells numeric", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- path
      list(
        studies = 7201L, studies_high_medium = 2092L, studies_high = 446L,
        studies_genetic = 3738L, studies_chemical = 3218L,
        studies_with_matrix = 3530L, studies_with_fastq = 6223L,
        studies_matrix_and_fastq = 2856L, studies_human = 3414L,
        samples = 465075L, cells = 560251604, first_year = 2008L,
        last_year = 2026L
      )
    }
  )
  out <- perturbation_summary(con = rest_con())
  expect_equal(seen, "/perturbation/summary")
  expect_true(is.double(out$cells))
  expect_equal(out$studies_high_medium, 2092L)
})

test_that("facets flatten to one row per value, across facet names", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        confidence = list(
          list(value = "high", studies = 446L),
          list(value = "medium", studies = 1646L)
        ),
        perturbation_type = list(list(value = "genetic", studies = 3363L))
      )
    }
  )
  out <- perturbation_facets(con = rest_con())
  expect_equal(nrow(out), 3)
  expect_equal(out$facet, c("confidence", "confidence", "perturbation_type"))
})

test_that("perturbation_projects pages by the server's offset until total is reached", {
  mock_pages(two_offset_pages)
  out <- perturbation_projects(con = rest_con())
  expect_equal(out$study_accession, c("GSE1", "GSE2"))
  expect_equal(attr(out, "total"), 2)
})

test_that("filters and booleans reach the server as-is and lowercase", {
  seen <- NULL
  path <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path_, ...) {
      path <<- path_
      seen <<- list(...)
      list(total = 0, count = 0, offset = 0, results = list())
    }
  )
  perturbation_projects(
    perturbation_type = "genetic", min_confidence = "medium",
    data_availability = "both", compound = "trametinib",
    has_matrix = TRUE, has_control_arm = FALSE, con = rest_con()
  )
  expect_equal(path, "/perturbation/projects")
  expect_equal(seen$perturbation_type, "genetic")
  expect_equal(seen$min_confidence, "medium")
  expect_equal(seen$data_availability, "both")
  expect_equal(seen$compound, "trametinib")
  expect_equal(seen$has_matrix, "true")
  expect_equal(seen$has_control_arm, "false")
  expect_equal(seen$sort, "confidence")
})

test_that("list columns and numeric counts survive the record spec", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(
        total = 1, count = 1, offset = 0,
        results = list(list(
          study_accession = "GSE1", n_cells = 3e9,
          compounds = list("trametinib", "cisplatin"),
          evidence = list("design_compound", "control_arm"),
          perturbation_methods = list("sci-Plex"),
          has_control_arm = TRUE, confidence = "high"
        ))
      )
    }
  )
  out <- perturbation_projects(con = rest_con())
  expect_equal(out$n_cells, 3e9)
  expect_equal(out$compounds[[1]], c("trametinib", "cisplatin"))
  expect_equal(out$evidence[[1]], c("design_compound", "control_arm"))
  expect_true(out$has_control_arm)
})

test_that("no studies is an empty tibble with the full column set, not an error", {
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) list(total = 0, count = 0, offset = 0, results = list())
  )
  out <- perturbation_projects(con = rest_con())
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.pert_project_spec()))
})
