test_that("summaries names the accessions that came back with no record", {
  local_mocked_bindings(
    .prj_study = function(con, accession) accession,
    .api_post = function(con, path, body, ...) list(list(accession = "GSE168652", title = "t")),
    .package = "seqout"
  )

  expect_warning(
    out <- summaries(c("GSE168652", "GSM1", "SRR1"), con = fake_con(backend = "api")),
    "GSM1"
  )
  expect_equal(nrow(out), 1)
})

test_that("summaries asks for the study a BioProject stands for", {
  posted <- NULL
  local_mocked_bindings(
    .prj_study = function(con, accession) {
      if (grepl("^PRJ", accession)) "CRA027437" else accession
    },
    .api_post = function(con, path, body, ...) {
      posted <<- body$accessions
      list(list(accession = "CRA027437"))
    },
    .package = "seqout"
  )

  expect_silent(summaries("PRJCA042384", con = fake_con(backend = "api")))
  expect_equal(posted, list("CRA027437"))
})
