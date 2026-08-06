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
