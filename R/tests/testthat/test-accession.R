test_that("accession shapes are named the same as in the Python client", {
  expect_equal(accession_kind("GSE168652"), "series")
  expect_equal(accession_kind("GSM5155196"), "sample")
  expect_equal(accession_kind("SRP310139"), "study")
  expect_equal(accession_kind("SRX10306523"), "experiment")
  expect_equal(accession_kind("SRS8447424"), "sample")
  expect_equal(accession_kind("SRR13927092"), "run")
  expect_equal(accession_kind("SRA123456"), "submission")
  expect_equal(accession_kind("SAMEA7015536"), "biosample")
  expect_equal(accession_kind("PRJNA1458007"), "study")
})

test_that("every archive prefix resolves", {
  expect_equal(accession_kind("ERP123456"), "study")
  expect_equal(accession_kind("DRP016022"), "study")
  expect_equal(accession_kind("DRR839815"), "run")
  expect_equal(accession_kind("CRA002740"), "study")
  expect_equal(accession_kind("HRA000925"), "study")
  expect_equal(accession_kind("CRX117570"), "experiment")
  expect_equal(accession_kind("HRR143507"), "run")
  expect_equal(accession_kind("HRS12345"), "sample")
})

test_that("GEA is tested before ArrayExpress, which it would otherwise match", {
  expect_equal(accession_kind("E-GEAD-657"), "series")
  expect_equal(accession_kind("E-MTAB-16863"), "series")
})

test_that("an unrecognised shape is NA rather than an error", {
  expect_true(is.na(accession_kind("nonsense")))
  expect_true(is.na(accession_kind("")))
})

test_that("case and surrounding space do not matter", {
  expect_equal(accession_kind("  gse168652  "), "series")
})

test_that("the archive is named alongside the kind, without a request", {
  expect_equal(
    accession_kind("GSE168652", archive = TRUE),
    c(kind = "series", archive = "geo")
  )
  expect_equal(accession_kind("SRR13927092", archive = TRUE)[["archive"]], "sra")
  expect_equal(accession_kind("ERP123456", archive = TRUE)[["archive"]], "ena")
  expect_equal(accession_kind("DRP016022", archive = TRUE)[["archive"]], "ddbj")
  expect_equal(accession_kind("E-MTAB-16863", archive = TRUE)[["archive"]], "arrayexpress")
  expect_equal(accession_kind("E-GEAD-657", archive = TRUE)[["archive"]], "gea")
  expect_equal(
    accession_kind("nonsense", archive = TRUE),
    c(kind = NA_character_, archive = NA_character_)
  )
})

test_that("a CNCB accession is GSA, not the generic shape it also matches", {
  # PRJC*/SAMC share the PRJ/SAM shapes but belong to GSA, so they are tested
  # first; the kind is unchanged either way.
  expect_equal(
    accession_kind("PRJCA042384", archive = TRUE),
    c(kind = "study", archive = "gsa")
  )
  expect_equal(accession_kind("CRA027437", archive = TRUE)[["archive"]], "gsa")
  expect_equal(accession_kind("SAMC1234", archive = TRUE)[["archive"]], "gsa")
  expect_equal(accession_kind("PRJNA1458007", archive = TRUE)[["archive"]], "bioproject")
  expect_equal(accession_kind("SAMEA7015536", archive = TRUE)[["archive"]], "biosample")

  # The default answer is untouched by any of it.
  expect_equal(accession_kind("PRJCA042384"), "study")
  expect_equal(accession_kind("SAMC1234"), "biosample")
})
