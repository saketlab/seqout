test_that("dataset accepts any accession and records what it is", {
  con <- fake_con()
  expect_equal(seqout_get(con = con, "GSE168652")$kind, "series")
  expect_equal(seqout_get(con = con, "SRR13927092")$kind, "run")
  expect_equal(seqout_get(con = con, "SRX10306523")$kind, "experiment")
  expect_equal(seqout_get(con = con, "SAMEA7015536")$kind, "biosample")
})

test_that("dataset rejects an accession it does not recognise", {
  expect_error(seqout_get(con = fake_con(), "nonsense"), "not an accession")
})

test_that("dataset trims surrounding whitespace", {
  expect_equal(seqout_get(con = fake_con(), "  GSE168652 ")$accession, "GSE168652")
})

test_that("dataset requires a connection", {
  expect_error(seqout_get("GSE168652", con = "not a connection"), "seqout_connection")
})

test_that("a study or series is its own project, with no request", {
  expect_equal(seqout_get(con = fake_con(), "GSE168652")$project, "GSE168652")
  expect_equal(seqout_get(con = fake_con(), "SRP310139")$project, "SRP310139")
  expect_equal(seqout_get(con = fake_con(), "CRA002740")$project, "CRA002740")
})

test_that("a study is its own sra, and a series its own geo", {
  expect_equal(seqout_get(con = fake_con(), "SRP310139")$sra, "SRP310139")
  expect_equal(seqout_get(con = fake_con(), "GSE168652")$geo, "GSE168652")
})

test_that("fields are cached, so a second read makes no new request", {
  d <- seqout_get(con = fake_con(), "GSE168652")
  expect_length(ls(d$cache), 0)
  d$project
  expect_true("project" %in% ls(d$cache))
  assign("project", "SENTINEL", envir = d$cache)
  expect_equal(d$project, "SENTINEL")
})

test_that("detail is NULL for a study or series", {
  expect_null(seqout_get(con = fake_con(), "GSE168652")$detail)
  expect_null(seqout_get(con = fake_con(), "SRP310139")$detail)
})

test_that("asking for a field that does not exist is an error, not NULL", {
  d <- seqout_get(con = fake_con(), "GSE168652")
  expect_error(d$not_a_field, "not a field")
})

test_that("the plumbing fields stay reachable", {
  d <- seqout_get(con = fake_con(), "GSE168652")
  expect_s3_class(d$con, "seqout_connection")
  expect_equal(d$accession, "GSE168652")
  expect_true(all(c("project", "meta", "samples", "runs", "pubs") %in% names(d)))
})

test_that("dataset prints without fetching anything", {
  d <- seqout_get(con = fake_con(), "GSE168652")
  expect_message(print(d), "GSE168652")
  expect_length(ls(d$cache), 0)
})

test_that("both spellings build the same object", {
  expect_equal(SeqoutGet(con = fake_con(), "GSE168652")$kind, seqout_get(con = fake_con(), "GSE168652")$kind)
})

test_that("supplementary flattens the record shape and the JSON shape", {
  recs <- list(
    list(`#text` = "ftp://x/GSE1_RAW.tar", `@type` = "TAR"),
    list(`#text` = "ftp://x/b.mtx.gz", `@type` = "MTX")
  )
  r <- seqout:::.supp_rows(recs, NA_character_)
  expect_equal(r$file, c("GSE1_RAW.tar", "b.mtx.gz"))
  expect_equal(r$type, c("TAR", "MTX"))
  expect_true(all(is.na(r$sample)))

  # The Parquet dump keeps the same JSON as a string, which carries no type.
  j <- seqout:::.supp_rows('[{"#text": "ftp://x/c.h5"}]', "GSM1")
  expect_equal(j$url, "ftp://x/c.h5")
  expect_true(is.na(j$type))
  expect_equal(j$sample, "GSM1")
})

test_that("supplementary joins the series and sample files into one table", {
  d <- seqout_get(con = fake_con(), "GSE168652")
  assign("meta", tibble::tibble(supplementary_data = list(list(
    list(`#text` = "ftp://x/GSE168652_RAW.tar", `@type` = "TAR")
  ))), envir = d$cache)
  assign("samples", tibble::tibble(
    accession = "GSM1",
    supplementary_data = list(list(
      list(`#text` = "ftp://x/GSM1_matrix.mtx.gz", `@type` = "MTX")
    ))
  ), envir = d$cache)

  s <- d$supplementary
  expect_equal(s$sample, c(NA, "GSM1"))
  expect_equal(s$file, c("GSE168652_RAW.tar", "GSM1_matrix.mtx.gz"))
})

test_that("supplementary is an empty table when the archive lists none", {
  d <- seqout_get(con = fake_con(), "SRP310139")
  assign("meta", tibble::tibble(accession = "SRP310139"), envir = d$cache)
  assign("samples", tibble::tibble(accession = "SRS1"), envir = d$cache)

  expect_equal(nrow(d$supplementary), 0)
  expect_named(d$supplementary, c("sample", "file", "type", "url"))
})

test_that("supplementary drops GEO's literal NONE placeholder", {
  none <- list(list(`#text` = "NONE", `@type` = "unknown"))
  expect_null(seqout:::.supp_rows(none, "GSM1"))
})

test_that("supplementary of a sample reads its own record, not its series", {
  d <- seqout_get(con = fake_con(), "GSM1")
  assign("detail", tibble::tibble(supplementary_data = list(list(
    list(`#text` = "ftp://x/GSM1_matrix.mtx.gz", `@type` = "MTX")
  ))), envir = d$cache)
  # No project in the cache: resolving one would be a request, and GEO does not
  # always serve a parent for a GSM.
  s <- d$supplementary
  expect_equal(s$sample, "GSM1")
  expect_equal(s$file, "GSM1_matrix.mtx.gz")
  expect_false("project" %in% ls(d$cache))
})

test_that("only a sample-level accession on the API has a detail envelope", {
  api <- fake_con(backend = "api")
  expect_true(seqout:::.has_detail_envelope(list(kind = "sample", con = api)))
  expect_true(seqout:::.has_detail_envelope(list(kind = "experiment", con = api)))
  expect_false(seqout:::.has_detail_envelope(list(kind = "series", con = api)))
  # The dump serves no envelope, so the study route stays.
  expect_false(seqout:::.has_detail_envelope(list(kind = "sample", con = fake_con())))
})

test_that("the runs of a sample cost no attempt to resolve its series", {
  local_mocked_bindings(
    .detail_part = function(con, accession, part) tibble::tibble(run_accession = "SRR1")
  )
  d <- seqout_get(con = fake_con(backend = "api"), "GSM1")

  expect_equal(d$runs$run_accession, "SRR1")
  expect_false("project" %in% ls(d$cache))
})

test_that("a GSM resolves to its series through the envelope's project_accession", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) list(project_accession = "GSE273612"),
    .package = "seqout"
  )
  expect_equal(seqout:::gsm_series("GSM8433846", con = fake_con(backend = "api")), "GSE273612")
})

test_that("a BioProject accession resolves to the record the archive files it under", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) list(project_accession = "CRA027437"),
    .package = "seqout"
  )
  d <- seqout_get(con = fake_con(backend = "api"), "PRJCA042384")
  expect_equal(d$project, "CRA027437")
})

test_that("a non-PRJ accession is left alone, at no request", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) stop("must not resolve"),
    .package = "seqout"
  )
  expect_equal(seqout_get(con = fake_con(backend = "api"), "GSE273612")$project, "GSE273612")
  # The dump serves no /prj/ route, so the accession stands.
  expect_equal(seqout_get(con = fake_con(), "PRJCA042384")$project, "PRJCA042384")
})

test_that("an SRA study's samples are samples, one row each, with their attributes", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(truncated = FALSE, rows = list(
        list(
          run_accession = "SRR1", experiment_accession = "SRX1",
          sample_accession = "SRS1", sample_title = "kidney rep 1",
          scientific_name = "Homo sapiens",
          `sample_attribute:tissue` = "Embryonic Kidney",
          `sample_attribute:sex` = "female"
        ),
        # A second run of the same sample must not become a second row.
        list(
          run_accession = "SRR2", experiment_accession = "SRX1",
          sample_accession = "SRS1", sample_title = "kidney rep 1",
          scientific_name = "Homo sapiens",
          `sample_attribute:tissue` = "Embryonic Kidney",
          `sample_attribute:sex` = "female"
        )
      ))
    }
  )
  out <- seqout:::.study_samples(fake_con(backend = "api"), "SRP1")
  expect_equal(nrow(out), 1L)
  expect_equal(out$accession, "SRS1")
  expect_equal(out$tissue, "Embryonic Kidney")
  expect_equal(out$sex, "female")
  # Run and experiment columns belong to $runs and $experiments.
  expect_false(any(c("run_accession", "experiment_accession") %in% names(out)))
})

test_that("a study whose rows carry no sample falls back rather than returning junk", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) list(truncated = FALSE, rows = list()),
    project_samples = function(accession, con = NULL) tibble::tibble(accession = "SRS9")
  )
  expect_equal(seqout:::.study_samples(fake_con(backend = "api"), "SRP1")$accession, "SRS9")
})

test_that("$detail reads like a row of $samples, with attributes as columns", {
  local_mocked_bindings(
    sample_detail = function(accession, con = NULL) {
      tibble::tibble(
        accession = "SRS1",
        title = "kidney",
        attributes_json = list(list(sex = "female", tissue = "gut"))
      )
    }
  )
  d <- seqout_get("SRS3425205", con = fake_con(backend = "api"))$detail
  expect_equal(d$sex, "female")
  expect_equal(d$tissue, "gut")
  # The nested column it came from is spent, so it does not linger beside them.
  expect_false("attributes_json" %in% names(d))
  expect_equal(d$accession, "SRS1")
})

test_that("unnesting $detail leaves the file list where $supplementary looks for it", {
  local_mocked_bindings(
    sample_detail = function(accession, con = NULL) {
      tibble::tibble(
        accession = "GSM1",
        supplementary_data = list(list(list(`#text` = "https://h/a.gz", `@type` = "TXT"))),
        # GEO files the pairs under a Characteristics key inside each channel.
        channels = list(list(list(
          Characteristics = list(list(`@tag` = "tissue", `#text` = "gut"))
        )))
      )
    }
  )
  d <- seqout_get("GSM1", con = fake_con(backend = "api"))
  expect_equal(d$detail$tissue, "gut")
  expect_equal(d$supplementary$url, "https://h/a.gz")
})

test_that("`[[` reads the same fields as `$`", {
  d <- seqout_get(con = fake_con(), "GSE168652")
  expect_equal(d[["project"]], d$project)
  expect_error(d[["nope"]], "not a field")
  expect_error(d[[1]], "one field name")
})
