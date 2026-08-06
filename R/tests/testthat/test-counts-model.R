FTP <- "https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM8207nnn/GSM8207499/suppl"
TRIPLET_PARTS <- c("matrix.mtx.gz", "barcodes.tsv.gz", "features.tsv.gz")

supp_file <- function(url, sample = NA_character_) {
  tibble::tibble(
    url = url, role = file_role(url), sample = sample,
    platform = NA_character_, member = NA_character_, name = basename(url)
  )
}

triplet <- function(gsm, prefix) {
  do.call(rbind, lapply(TRIPLET_PARTS, function(part) {
    supp_file(paste0(FTP, "/", prefix, "_", part), gsm)
  }))
}

group <- function(files, accession = "GSE1", assay = "rna") {
  seqout:::.group_units(files, accession, assay)
}

preferred <- function(units) Filter(function(u) isTRUE(u$preferred), units)

test_that("group builds one unit per triplet", {
  units <- group(rbind(triplet("GSM1", "GSM1_a"), triplet("GSM2", "GSM2_b")))
  expect_equal(vapply(units, function(u) u$fmt, character(1)), c("10x_mtx", "10x_mtx"))
  expect_setequal(vapply(units, function(u) u$sample, character(1)), c("GSM1", "GSM2"))
  expect_true(all(vapply(units, function(u) length(u$files) == 3L, logical(1))))
})

test_that("group drops an incomplete triplet", {
  files <- triplet("GSM1", "GSM1_a")[1:2, ]
  expect_length(group(files), 0)
})

test_that("a structured format is preferred over a table, and both are kept", {
  files <- rbind(
    triplet("GSM1", "GSM1_filtered"),
    supp_file(paste0(FTP, "/GSM1_counts.csv.gz"), "GSM1")
  )
  units <- group(files)
  expect_equal(vapply(preferred(units), function(u) u$fmt, character(1)), "10x_mtx")
  expect_setequal(
    vapply(units, function(u) u$label, character(1)),
    c("GSM1:10x_mtx", "GSM1:table")
  )
})

test_that("series-level files are never auto-selected", {
  files <- rbind(
    triplet("GSM1", "GSM1_a"),
    supp_file(paste0(FTP, "/GSE1_RAW.tar")),
    supp_file(paste0(FTP, "/GSE1_counts.csv.gz"))
  )
  units <- group(files)
  expect_equal(vapply(preferred(units), function(u) u$sample, character(1)), "GSM1")
  expect_setequal(
    vapply(Filter(function(u) !u$preferred, units), function(u) u$label, character(1)),
    c("GSE1_RAW.tar", "GSE1_counts.csv.gz")
  )
})

test_that("a series-level file is selected when it is all there is", {
  units <- group(supp_file(paste0(FTP, "/GSE1_counts.csv.gz")))
  expect_length(units, 1)
  expect_true(units[[1]]$preferred)
})

test_that("metadata files attach to the units they describe", {
  files <- rbind(
    triplet("GSM1", "GSM1_a"),
    supp_file(paste0(FTP, "/GSE1_cell_metadata.csv.gz"))
  )
  units <- group(files)
  expect_length(units[[1]]$metadata_files, 1)
  expect_true(seqout:::.unit_has_metadata(units[[1]]))
})

test_that("rds and h5ad carry their own metadata, a bare table does not", {
  for (name in c("GSE1_x.rds", "GSE1_x.h5ad")) {
    unit <- group(supp_file(paste0(FTP, "/", name)))[[1]]
    expect_true(seqout:::.unit_has_metadata(unit), info = name)
  }
  unit <- group(supp_file(paste0(FTP, "/GSE1_counts.csv.gz")))[[1]]
  expect_false(seqout:::.unit_has_metadata(unit))
})

test_that("the requested assay wins when a sample ships several", {
  files <- rbind(
    supp_file(paste0(FTP, "/GSM1_adt_C001.h5ad"), "GSM1"),
    supp_file(paste0(FTP, "/GSM1_rna_C001.h5ad"), "GSM1")
  )
  expect_match(preferred(group(files, assay = "rna"))[[1]]$files[[1]]$name, "rna")
  expect_match(preferred(group(files, assay = "adt"))[[1]]$files[[1]]$name, "adt")
  expect_length(group(files, assay = "rna"), 2)
})

test_that("units of one sample get labels that tell them apart", {
  files <- rbind(
    supp_file(paste0(FTP, "/GSM1_adt_C001.h5ad"), "GSM1"),
    supp_file(paste0(FTP, "/GSM1_rna_C001.h5ad"), "GSM1")
  )
  labels <- vapply(group(files), function(u) u$label, character(1))
  expect_equal(length(unique(labels)), length(labels))
})

test_that("kind is decided on evidence", {
  barcodes <- rep(c("AAACCTGAGAAACCAT-1", "AAACCTGAGAAACCGC-1"), 300)
  expect_equal(seqout:::.infer_kind(barcodes)$kind, "single_cell")
  expect_equal(seqout:::.infer_kind(paste0("GSM", 1000:1011))$kind, "bulk")
  expect_equal(seqout:::.infer_kind(paste0("S", 1:3))$kind, "bulk")
  expect_equal(seqout:::.infer_kind(paste0("c", 1:1000))$kind, "single_cell")
})

test_that("the Smart-seq band stays unknown rather than guessing", {
  res <- seqout:::.infer_kind(paste0("cell_", 1:384))
  expect_equal(res$kind, "unknown")
  expect_true(any(grepl("Smart-seq", res$evidence)))
})

test_that("a series sample count decides an otherwise ambiguous table", {
  obs <- sprintf("SD%03d", 1:68)
  expect_equal(seqout:::.infer_kind(obs, 87L)$kind, "bulk")
  expect_equal(seqout:::.infer_kind(obs)$kind, "unknown")
})
