test_that("fragments file names are recognised across submitter spellings", {
  expect_true(all(seqout:::.is_fragments(c(
    "GSM1_fragments.tsv.gz",
    "GSM1_atac_fragments.tsv.gz",
    "X061_perm-cells_ds125M_filtered-fragments.tsv.gz",
    "GSM4156590_GM12878.rep1.atac.fragments.bed.gz",
    "GSM1_fragments.tsv"
  ))))
})

test_that("the index, the metrics and the matrix are not fragments", {
  expect_false(any(seqout:::.is_fragments(c(
    "GSM1_fragments.tsv.gz.tbi",
    "GSM1_per_barcode_metrics.csv.gz",
    "GSM1_matrix.mtx.gz",
    "GSM1_barcodes.tsv.gz",
    "fragments_summary.pdf"
  ))))
})

test_that("an ATAC study lists a fragments file per sample", {
  skip_unless_live()

  counts <- counts_of("GSE156478")
  frags <- suppressMessages(seqout_fragments(counts))

  expect_s3_class(frags, "tbl_df")
  expect_true(all(c("sample", "file", "url", "indexed", "path") %in% names(frags)))
  expect_gte(nrow(frags), 17L)
  expect_true(all(grepl("fragments", frags$file)))
  expect_true(all(startsWith(frags$sample, "GSM")))
  # nothing is fetched until asked for
  expect_true(all(is.na(frags$path)))
})

test_that("fragments narrow to the samples asked for", {
  skip_unless_live()

  counts <- counts_of("GSE156478")
  frags <- suppressMessages(seqout_fragments(counts, sample = "GSM5065524"))

  expect_equal(nrow(frags), 1L)
  expect_equal(frags$sample, "GSM5065524")
  expect_match(frags$file, "^GSM5065524_.*fragments[.]tsv[.]gz$")
})

test_that("GEO deposits no tabix index, and the caller is told", {
  skip_unless_live()

  counts <- counts_of("GSE156478")
  expect_message(seqout_fragments(counts), "indexTabix")
  expect_false(any(suppressMessages(seqout_fragments(counts))$indexed))
})

test_that("a study with no ATAC warns rather than returning nothing quietly", {
  skip_unless_live()

  counts <- counts_of("GSE297547")
  expect_warning(frags <- seqout_fragments(counts), "no fragments file")
  expect_equal(nrow(frags), 0L)
})

test_that("a multiome study ships fragments beside its peak matrix", {
  skip_unless_live()

  counts <- counts_of("GSE200046")
  frags <- suppressMessages(seqout_fragments(counts))

  expect_gte(nrow(frags), 4L)
})

test_that("fragments needs a counts table, not an accession", {
  expect_error(seqout_fragments("GSE156478"), "seqout_counts")
})
