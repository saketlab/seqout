unit_of <- function(names, fmt = "table", sample = "GSM1") {
  list(
    label = sample, fmt = fmt, sample = sample, platform = NA_character_,
    files = lapply(names, function(n) list(name = n, url = n, role = "table"))
  )
}

test_that("modality is named for a whole vector at once", {
  expect_equal(
    seqout:::.modality_in_vec(c("GSM1_rna_x", "GSM1_adt_x", "GSM1_nothing")),
    c("rna", "adt", NA_character_)
  )
})

test_that("each modality token is recognised", {
  expect_equal(
    seqout:::.modality_in_vec(c(
      "GSM1_rna.h5ad", "GSM1_gex.mtx", "GSM1_adt.h5ad", "GSM1_antibody.csv",
      "GSM1_hto.csv", "GSM1_hashtag.tsv", "GSM1_atac_peaks.tsv", "plain.txt", ""
    )),
    c("rna", "rna", "adt", "adt", "hto", "hto", "atac", NA_character_, NA_character_)
  )
})

test_that("a matching assay ranks ahead of a mismatched one", {
  ranks <- seqout:::.modality_rank(c("GSM1_rna", "GSM1_adt", "GSM1_plain"), "rna")
  expect_equal(ranks, c(0L, 2L, 1L))
})

test_that("with no assay asked for, nothing is preferred on modality", {
  expect_equal(seqout:::.modality_rank(c("GSM1_rna", "GSM1_adt"), NULL), c(1L, 1L))
})

test_that("filtered output ranks ahead of raw", {
  ranks <- seqout:::.unit_ranks(
    list(unit_of("GSM1_filtered_matrix.csv"), unit_of("GSM1_raw_matrix.csv")),
    "rna"
  )
  expect_lt(ranks[1], ranks[2])
})

test_that("filtered is judged per file, not on the joined names", {
  mixed <- unit_of(c("GSM1_unfiltered_barcodes.tsv", "GSM1_filtered_matrix.csv"))
  plain <- unit_of("GSM1_raw_matrix.csv")
  ranks <- seqout:::.unit_ranks(list(mixed, plain), "rna")
  expect_lt(ranks[1], ranks[2])
})

test_that("a more structured format wins when nothing else separates units", {
  ranks <- seqout:::.unit_ranks(
    list(unit_of("a.mtx", "10x_mtx"), unit_of("b.csv", "table")), "rna"
  )
  expect_lt(ranks[1], ranks[2])
})

test_that("ranking every unit at once matches ranking them one by one", {
  one_by_one <- function(u, assay) {
    fn <- vapply(u$files, function(f) f$name, character(1))
    found <- seqout:::.modality_in_vec(paste(fn, collapse = " "))
    md <- if (is.null(assay) || is.na(assay) || is.na(found)) {
      1L
    } else if (identical(found, assay)) {
      0L
    } else {
      2L
    }
    filt <- if (any(is_filtered(fn))) 0L else 1L
    md * 100 + filt * 10 + unname(seqout:::.fmt_rank[[u$fmt]])
  }
  units <- list(
    unit_of("GSM1_rna_filtered.mtx", "10x_mtx"),
    unit_of("GSM1_adt_raw.h5ad", "h5ad"),
    unit_of(c("GSM1_unfiltered.tsv", "GSM1_filtered.csv"), "table"),
    unit_of("GSM1_plain.rds", "rds")
  )
  for (assay in list("rna", "adt", NULL)) {
    expect_equal(
      seqout:::.unit_ranks(units, assay),
      vapply(units, one_by_one, numeric(1), assay = assay)
    )
  }
})

test_that("nested and flat names group correctly in the same call", {
  expect_equal(
    group_key(c("GSM1_x_matrix.mtx.gz", "GSM2/raw_feature_bc_matrix/matrix.mtx.gz")),
    c("gsm1_x", "gsm2/raw_feature_bc_matrix")
  )
})

test_that("a column is taken from every split line without a per-line call", {
  split <- strsplit(c("a\tGeneA\tGene Expression", "b\tGeneB\tAntibody Capture"), "\t")
  expect_equal(seqout:::.column_of(split, 3L), c("Gene Expression", "Antibody Capture"))
  expect_equal(seqout:::.column_of(split, 1L), c("a", "b"))
})

test_that("a short line falls back to its first field", {
  split <- list(c("a", "GeneA", "Gene Expression"), "b")
  expect_equal(seqout:::.column_of(split, 3L), c("Gene Expression", "b"))
})

test_that("no lines means no column", {
  expect_equal(seqout:::.column_of(list(), 1L), character(0))
})
