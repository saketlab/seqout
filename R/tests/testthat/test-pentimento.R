sample_records <- list(
  list(
    sample_accession = "GSM5155196",
    cells = 14220L, genes = 33694L, nnz = 32645492,
    file_format = "mtx", unfiltered = FALSE,
    n_runs = 1L, n_runs_measurable = 1L,
    has_viral_reads = FALSE, has_bacterial_reads = FALSE,
    species_called = "human", species_hit_reads = 12000L,
    species_hit_fraction = 0.03, species_margin = 0.9,
    sex_verdict = "female", y_hits = 0L, xist_hits = 800L,
    calls_ambiguous = FALSE, flags = list(),
    n_flags = 0L, title = "Cells from cervical cancer tissue",
    tissue = "Cervical"
  ),
  list(
    sample_accession = "GSM8994520",
    cells = 11032L, genes = 25259L, nnz = NULL,
    file_format = "h5ad", unfiltered = TRUE,
    assay = "Drop-seq", assay_is_single_cell = TRUE,
    n_flags = 0L
  )
)

organism_records <- list(
  list(
    organism = "HPV16", kingdom = "viral", class = "virus",
    n_unitigs = 45L, kmer_mass = 10695.2, reads = 153,
    covered_bp = 1369, max_breadth_frac = 0.1732,
    is_validated_viral = FALSE, is_viral_evidence = FALSE,
    is_validated_bacterial = FALSE
  ),
  list(
    organism = "Mycoplasma_hominis", kingdom = "bacterial", class = "pathogen",
    n_unitigs = 157L, kmer_mass = 79097.1, reads = 1130,
    covered_bp = 30700, max_breadth_frac = 0.0461,
    is_validated_viral = FALSE, is_viral_evidence = FALSE,
    is_validated_bacterial = FALSE
  )
)

sample_tbl <- seqout:::.pnt_tibble(sample_records, seqout:::.pnt_sample_spec)

test_that("cells and genes come back as integers", {
  out <- sample_tbl
  expect_s3_class(out, "tbl_df")
  expect_type(out$cells, "integer")
  expect_type(out$genes, "integer")
  expect_equal(out$cells, c(14220L, 11032L))
  expect_equal(out$genes, c(33694L, 25259L))
})

test_that("an unscreened sample keeps NA", {
  out <- sample_tbl
  expect_type(out$has_viral_reads, "logical")
  expect_false(out$has_viral_reads[1])
  expect_true(is.na(out$has_viral_reads[2]))
  expect_true(is.na(out$assay[1]))
  expect_equal(out$assay[2], "Drop-seq")
})

test_that("unfiltered marks a barcode count", {
  out <- sample_tbl
  expect_false(out$unfiltered[1])
  expect_true(out$unfiltered[2])
})

test_that("a missing numeric becomes NA and keeps its row", {
  out <- sample_tbl
  expect_equal(nrow(out), 2)
  expect_true(is.na(out$nnz[2]))
  expect_equal(out$nnz[1], 32645492)
})

test_that("no records still gives the full set of typed columns", {
  out <- seqout:::.pnt_tibble(list(), seqout:::.pnt_sample_spec)
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.pnt_sample_spec))
  expect_type(out$cells, "integer")
  expect_type(out$has_viral_reads, "logical")
})

test_that("organism rows carry the kingdom and the evidence numbers", {
  out <- seqout:::.pnt_tibble(organism_records, seqout:::.pnt_organism_spec)
  expect_equal(out$organism, c("HPV16", "Mycoplasma_hominis"))
  expect_equal(out$kingdom, c("viral", "bacterial"))
  expect_type(out$n_unitigs, "integer")
  expect_equal(out$max_breadth_frac[1], 0.1732)
})

test_that("both functions refuse a Parquet connection and say why", {
  con <- fake_con(backend = "parquet")
  expect_error(project_single_cell("GSE1", con = con), "reads the REST API")
  expect_error(project_single_cell("GSE1", con = con), "no Pentimento table")
  expect_error(sample_microbes("GSM1", con = con), "reads the REST API")
})

test_that("sample_microbes only takes the kinds the API knows", {
  expect_error(
    sample_microbes("GSM1", kind = "fungal", con = fake_con(backend = "api")),
    "arg"
  )
})

test_that("the evidence behind each call comes back typed", {
  out <- sample_tbl
  expect_type(out$species_hit_reads, "integer")
  expect_type(out$species_hit_fraction, "double")
  expect_type(out$y_xist_ratio, "double")
  expect_equal(out$species_hit_reads, c(12000L, NA_integer_))
  expect_equal(out$xist_hits, c(800L, NA_integer_))
  expect_equal(out$species_called[1], "human")
  expect_equal(out$species_hit_fraction[1], 0.03)
})

test_that("flags is a list column that keeps absent apart from empty", {
  out <- sample_tbl
  expect_type(out$flags, "list")
  expect_equal(nrow(out), 2)
  expect_equal(out$flags[[1]], character(0))
  expect_null(out$flags[[2]])
})

test_that("a populated flag list survives as characters", {
  rec <- list(list(sample_accession = "GSM1", flags = list("low_reads", "mixed")))
  out <- seqout:::.pnt_tibble(rec, seqout:::.pnt_sample_spec)
  expect_equal(out$flags[[1]], c("low_reads", "mixed"))
})

test_that("the columns match the shared contract the Python client also reads", {
  # Source checkouts have the root contract; R CMD check tarballs do not.
  skip_if_not_installed("jsonlite")
  path <- testthat::test_path("..", "..", "..", "schema", "pentimento-fields.json")
  skip_if(!file.exists(path), "shared schema is outside the built package")

  schema <- jsonlite::fromJSON(path, simplifyVector = TRUE)
  expect_equal(names(seqout:::.pnt_sample_spec), schema$sample_ordered)
  expect_equal(sort(names(seqout:::.pnt_study_spec)), sort(schema$study))
  expect_equal(sort(names(seqout:::.pnt_organism_spec)), sort(schema$organism))
  expect_equal(sort(names(seqout:::.pnt_detection_spec)), sort(schema$detection))
  expect_equal(sort(names(seqout:::.pnt_kingdom_spec)), sort(schema$kingdom))
})

test_that("a limit past one page still pages", {
  requests <- list()
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      args <- list(...)
      requests[[length(requests) + 1]] <<- args$offset
      n <- max(0, min(args$limit, 2500 - args$offset))
      rows <- lapply(seq_len(n), function(i) {
        list(sample_accession = paste0("GSM", args$offset + i))
      })
      list(n_samples_detailed = 2500, samples = rows)
    }
  )
  out <- project_single_cell("GSE1", limit = 1500, con = fake_con(backend = "api"))
  expect_equal(nrow(out), 1500)
  expect_equal(unlist(requests), c(0, 1000))
})

test_that("both functions are exported under a PascalCase alias", {
  expect_identical(ProjectSingleCell, project_single_cell)
  expect_identical(SampleMicrobes, sample_microbes)
})

test_that("every sample arrives without a hand-rolled offset loop", {
  requests <- list()
  page <- function(offset, total, size) {
    rows <- lapply(
      seq_len(max(0, min(size, total - offset))),
      function(i) list(sample_accession = paste0("GSM", offset + i))
    )
    list(n_samples_detailed = total, samples = rows)
  }
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      args <- list(...)
      requests[[length(requests) + 1]] <<- args$offset
      page(args$offset, total = 2500, size = args$limit)
    }
  )
  out <- project_single_cell("GSE1", con = fake_con(backend = "api"))
  expect_equal(nrow(out), 2500)
  expect_equal(unlist(requests), c(0, 1000, 2000))
  expect_equal(attr(out, "n_samples_total"), 2500L)
})

test_that("an explicit limit reads one page only", {
  requests <- list()
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      args <- list(...)
      requests[[length(requests) + 1]] <<- args$limit
      rows <- lapply(
        seq_len(args$limit),
        function(i) list(sample_accession = paste0("GSM", i))
      )
      list(n_samples_detailed = 2500, samples = rows)
    }
  )
  out <- project_single_cell("GSE1", limit = 10, con = fake_con(backend = "api"))
  expect_equal(nrow(out), 10)
  expect_equal(unlist(requests), 10)
})

test_that("a study outside the Pentimento gives typed columns and no rows", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) NULL
  )
  out <- project_single_cell("GSE1", con = fake_con(backend = "api"))
  expect_equal(nrow(out), 0)
  expect_named(out, names(seqout:::.pnt_sample_spec))
})

test_that("an unscreened sample warns instead of reading as clean", {
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      list(measurable = NULL, n_runs = 0, by_organism = list(), detections = list())
    }
  )
  expect_warning(
    out <- sample_microbes("GSM1", con = fake_con(backend = "api")),
    "never screened"
  )
  expect_equal(nrow(out), 0)
  expect_true(is.na(attr(out, "measurable")))
})

test_that("one request carries both the organism and the run views", {
  calls <- 0
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      calls <<- calls + 1
      list(
        measurable = TRUE, n_runs = 1,
        by_organism = organism_records,
        detections = list(list(
          run_accession = "SRR1", organism = "HPV16",
          kingdom = "viral", class = "virus", breadth_frac = 0.1732
        ))
      )
    }
  )
  m <- sample_microbes("GSM1", con = fake_con(backend = "api"))
  expect_equal(m$organism, c("HPV16", "Mycoplasma_hominis"))
  expect_equal(attr(m, "detections")$run_accession, "SRR1")

  d <- sample_microbes("GSM1", detail = TRUE, con = fake_con(backend = "api"))
  expect_equal(d$run_accession, "SRR1")
  expect_equal(attr(d, "by_organism")$organism, c("HPV16", "Mycoplasma_hominis"))
  expect_equal(calls, 2)
})
