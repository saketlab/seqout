test_that("file roles match the Python classifier", {
  expect_equal(file_role("GSM123_matrix.mtx.gz"), "mtx")
  expect_equal(file_role("GSM123_barcodes.tsv.gz"), "barcodes")
  expect_equal(file_role("GSM123_features.tsv.gz"), "features")
  expect_equal(file_role("GSM123_genes.tsv.gz"), "features")
  expect_equal(file_role("GSM123_filtered_feature_bc_matrix.h5"), "h5")
  expect_equal(file_role("GSE1_adata.h5ad.gz"), "h5ad")
  expect_equal(file_role("GSE1_seurat.rds.gz"), "rds")
  expect_equal(file_role("GSE1_RAW.tar"), "tar")
  expect_equal(file_role("GSE1_counts.csv.gz"), "table")
})

test_that("sidecars are skipped whatever their extension says", {
  expect_equal(file_role("GSM1_atac_fragments.tsv.gz"), "skip")
  expect_equal(file_role("GSM1_README.txt"), "skip")
  expect_equal(file_role("GSM1_tissue_positions_list.csv.gz"), "skip")
  expect_equal(file_role("GSM1_scalefactors.json.gz"), "skip")
  expect_equal(file_role("GSM1.bam"), "skip")
  expect_equal(file_role("GSM1_image.tif.gz"), "skip")
})

test_that("the sidecar list does not eat real counts files", {
  for (name in c(
    "GSM1.bwa_counts.tsv.gz", "GSM1_summary_counts.tsv",
    "GSM1.bedtools_counts.tsv", "GSE1_rawcounts.json.tsv"
  )) {
    expect_equal(file_role(name), "table", info = name)
  }
})

test_that("qualifier words do not make a file look like counts", {
  for (name in c(
    "GSE164378_sc.meta.data_3P.csv.gz", "GSE1_seurat_metadata.tsv.gz",
    "GSE1_filtered_cell_metadata.csv", "GSE1_normalized_cell_metadata.csv"
  )) {
    expect_equal(file_role(name), "metadata", info = name)
  }
  expect_equal(file_role("GSE264648_counts_all_celltype.rds.gz"), "rds")
  expect_equal(file_role("GSE1_raw_umi_by_celltype.csv.gz"), "table")
  expect_equal(file_role("GSE1_filtered_expr_annotation.tsv"), "table")
})

test_that("annotation hints demote a file when no counts word is present", {
  expect_equal(file_role("GSE1_celltype_annotation.csv"), "metadata")
  expect_equal(file_role("GSE1_cell_metadata.rds"), "metadata")
})

test_that("a triplet shares one group key", {
  keys <- unique(vapply(
    c(
      "GSM123_pbmc_matrix.mtx.gz", "GSM123_pbmc_barcodes.tsv.gz",
      "GSM123_pbmc_features.tsv.gz"
    ),
    group_key, character(1)
  ))
  expect_equal(unname(keys), "gsm123_pbmc")
})

test_that("a CellRanger directory wins over the filename", {
  expect_equal(
    group_key("GSM123/filtered_feature_bc_matrix/matrix.mtx.gz"),
    "gsm123/filtered_feature_bc_matrix"
  )
  expect_false(identical(
    group_key("GSM123/raw_feature_bc_matrix/matrix.mtx.gz"),
    group_key("GSM123/filtered_feature_bc_matrix/matrix.mtx.gz")
  ))
})

test_that("filtered output is recognised, unfiltered is not", {
  expect_true(is_filtered("GSM1_filtered_feature_bc_matrix.h5"))
  expect_false(is_filtered("GSM1_raw_feature_bc_matrix.h5"))
  expect_false(is_filtered("GSM1_unfiltered_matrix.h5"))
})
