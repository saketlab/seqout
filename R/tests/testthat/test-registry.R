test_that("every registry row has the fields the dispatchers read", {
  for (row in seqout:::.accession_registry) {
    expect_type(row$pattern, "character")
    expect_true(row$entity %in% c(
      "series", "study", "experiment", "sample", "run", "biosample", "submission"
    ), info = row$pattern)
    expect_type(row$archive, "character")
    if (!is.null(row$table)) {
      expect_length(row$cols, 3)
    }
  }
})

test_that("accessions route to the table that holds them", {
  to_table <- function(a) seqout:::.accession_to_table(a)
  expect_equal(to_table("GSE168652"), "geo_series")
  expect_equal(to_table("SRP310139"), "sra_studies")
  expect_equal(to_table("ERP123456"), "ena_studies")
  expect_equal(to_table("DRP016022"), "sra_studies")
  expect_equal(to_table("PRJNA1458007"), "sra_studies")
  expect_equal(to_table("E-MTAB-16863"), "arrayexpress_experiments")
})

test_that("GSA studies resolve to their own table", {
  expect_equal(seqout:::.accession_to_table("CRA002740"), "gsa_studies")
  expect_equal(seqout:::.accession_to_table("HRA000925"), "gsa_studies")
})

test_that("GEA is not routed to the ArrayExpress table", {
  expect_equal(seqout:::.accession_to_table("E-GEAD-657"), "gea_experiments")
  expect_equal(seqout:::.accession_to_table("E-MTAB-16863"), "arrayexpress_experiments")
})

test_that("an accession with no table aborts rather than guessing", {
  expect_error(seqout:::.accession_to_table("GSM5155196"), "Cannot determine table")
  expect_error(seqout:::.accession_to_table("nonsense"), "Cannot determine table")
})

test_that("column names come from the registry row, not a hardcoded switch", {
  expect_equal(
    seqout:::.table_column_map("ena_studies"),
    list(acc_col = "study_accession", title_col = "study_title", desc_col = "study_description")
  )
  expect_equal(
    seqout:::.table_column_map("gsa_studies"),
    list(acc_col = "study_accession", title_col = "study_title", desc_col = "study_description")
  )
  expect_equal(seqout:::.table_column_map("geo_series")$desc_col, "summary")
  expect_equal(seqout:::.table_column_map("sra_studies")$desc_col, "abstract")
})

test_that("an unknown table falls back rather than erroring", {
  m <- seqout:::.table_column_map("some_new_table")
  expect_equal(m$acc_col, "accession")
})

test_that("archive membership drives the study and series tests", {
  expect_true(seqout:::.in_archive("SRP310139", seqout:::.study_archives))
  expect_true(seqout:::.in_archive("CRA002740", seqout:::.study_archives))
  expect_true(seqout:::.in_archive("PRJNA1458007", seqout:::.study_archives))
  expect_false(seqout:::.in_archive("GSE168652", seqout:::.study_archives))

  expect_true(seqout:::.in_archive("GSE168652", seqout:::.geo_archives))
  expect_true(seqout:::.in_archive("E-MTAB-16863", seqout:::.geo_archives))
  expect_true(seqout:::.in_archive("E-GEAD-657", seqout:::.geo_archives))
  expect_false(seqout:::.in_archive("SRP310139", seqout:::.geo_archives))
})

test_that("an unrecognised accession belongs to no archive", {
  expect_false(seqout:::.in_archive("nonsense", seqout:::.study_archives))
  expect_false(seqout:::.in_archive("nonsense", seqout:::.geo_archives))
})

test_that("every table the registry names is one the server publishes", {
  named <- unique(unlist(lapply(seqout:::.accession_registry, function(r) r$table)))
  expect_true(all(named %in% seqout:::.seqout_tables()), info = paste(
    setdiff(named, seqout:::.seqout_tables()),
    collapse = ", "
  ))
})
