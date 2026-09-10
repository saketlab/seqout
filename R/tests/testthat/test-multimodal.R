# Building multimodal objects from real series. These download, so each one
# caps the cells it keeps.

test_that("a CITE-seq h5ad series builds paired Seurat assays and metadata", {
  skip_unless_live()
  skip_if_not_installed("SeuratObject")
  spec <- gse_by_accession("GSE297547")
  skip_unless_readable(spec$formats)

  obj <- suppressWarnings(live(seqout_seurat(
    spec$accession,
    sample = spec$samples, max_cells = 150
  )))
  rna <- SeuratObject::LayerData(obj, assay = "RNA", layer = "counts")
  adt <- SeuratObject::LayerData(obj, assay = "ADT", layer = "counts")
  meta <- obj[[]]

  expect_s4_class(obj, "Seurat")
  expect_setequal(SeuratObject::Assays(obj), c("RNA", "ADT"))
  expect_equal(SeuratObject::DefaultAssay(obj), "RNA")
  expect_gt(nrow(obj[["RNA"]]), nrow(obj[["ADT"]]))
  expect_identical(colnames(rna), colnames(adt))
  expect_identical(colnames(rna), colnames(obj))
  expect_true("sample" %in% names(meta))
  expect_setequal(unique(meta$sample), spec$samples)
  # The submitter's own per-cell columns survive the merge.
  expect_true(any(c("type1", "type3") %in% names(meta)))

  flat <- live(seqout_seurat(
    spec$accession,
    sample = spec$samples[[1]], max_cells = 120, multimodal = FALSE
  ))
  expect_length(SeuratObject::Assays(flat), 1L)

  annotated <- suppressWarnings(live(seqout_seurat(
    spec$accession,
    sample = spec$samples[[1]], max_cells = 100, sample_metadata = TRUE
  )))
  annotated_meta <- annotated[[]]
  expect_true(all(c("title", "Sex", "tissue") %in% names(annotated_meta)))
  expect_equal(length(unique(annotated_meta$title)), 1L)
})

test_that("a series whose modalities sit on separate GSMs stays single-assay", {
  skip_unless_live()
  skip_if_not_installed("SeuratObject")
  spec <- gse_by_accession("GSE164378")
  skip_unless_readable(spec$formats)

  counts <- counts_of(spec$accession)
  gsm <- counts$sample[counts$preferred & !is.na(counts$sample)][[1]]
  obj <- live(seqout_seurat(counts, sample = gsm, max_cells = 100))

  expect_length(SeuratObject::Assays(obj), 1L)
})

test_that("an rds series pairs ADT with RNA and reports missing antibodies", {
  skip_unless_live()
  skip_if_not_installed("SeuratObject")
  spec <- gse_by_accession("GSE139369")

  obj <- suppressWarnings(
    live(seqout_seurat(spec$accession, sample = spec$samples[[1]], max_cells = 100))
  )
  counts <- counts_of(spec$accession)
  unit <- counts$unit[counts$sample %in% spec$samples[[1]] & counts$assay %in% "adt"][[1]]
  m <- live(seqout_matrix(counts, sample = unit))

  expect_setequal(SeuratObject::Assays(obj), c("RNA", "ADT"))
  expect_equal(ncol(obj), 100L)
  # The antibody panel and transcriptome have different feature sets.
  expect_equal(nrow(obj[["ADT"]]), 21L)
  expect_true(anyNA(m$X))
  expect_gt(seqout:::.all_na_rows(m$X), 0L)
  expect_warning(
    seqout:::.bind_units(list(GSM4138872 = m), labels = spec$samples[[1]]),
    "NA in every cell"
  )
})

test_that("a trimodal sample carries all three assays", {
  skip_unless_live()

  spec <- gse_by_accession("GSE158013")
  counts <- counts_of(spec$accession)
  groups <- seqout:::.modal_groups(counts, spec$samples[[1]])

  expect_setequal(names(groups), c("adt", "atac", "rna"))
})

test_that("a multimodal series becomes a SingleCellExperiment with altExps", {
  skip_unless_live()
  skip_if_not_installed("SingleCellExperiment")
  spec <- gse_by_accession("GSE297547")
  skip_unless_readable(spec$formats)

  sce <- live(seqout_sce(spec$accession, sample = spec$samples[[1]], max_cells = 120))

  expect_s4_class(sce, "SingleCellExperiment")
  expect_equal(SingleCellExperiment::altExpNames(sce), "ADT")
  expect_equal(ncol(SingleCellExperiment::altExp(sce, "ADT")), ncol(sce))
})

test_that("a DOGMA-seq protein triplet groups despite its naming", {
  skip_unless_live()

  spec <- gse_by_accession("GSE156478")
  counts <- counts_of(spec$accession)
  row <- counts[counts$sample %in% spec$samples[[2]], ]

  expect_equal(nrow(row), 1L)
  expect_equal(row$format, "10x_mtx")
  expect_equal(row$n_files, 3L)
  expect_equal(row$assay, "adt")
})

test_that("the DOGMA-seq protein matrix reads", {
  skip_unless_live()

  spec <- gse_by_accession("GSE156478")
  counts <- counts_of(spec$accession)
  m <- live(seqout_matrix(counts, sample = spec$samples[[2]]))

  expect_equal(nrow(m$X), 210L)
  expect_true(all(c("CD80", "CD86") %in% rownames(m$X)))
})

test_that("a multiome unit splits into RNA and ATAC by feature type", {
  skip_unless_live()
  skip_if_not_installed("SeuratObject")

  spec <- gse_by_accession("GSE156478")
  counts <- counts_of(spec$accession)
  obj <- live(seqout_seurat(counts, sample = spec$samples[[1]], max_cells = 200))

  expect_setequal(SeuratObject::Assays(obj), c("RNA", "ATAC"))
  expect_equal(SeuratObject::DefaultAssay(obj), "RNA")
  expect_equal(nrow(obj[["RNA"]]), 36601L)
  expect_equal(nrow(obj[["ATAC"]]), 84846L)
})

test_that("a 10x read carries the feature type so a multiome can be split", {
  skip_unless_live()

  spec <- gse_by_accession("GSE156478")
  counts <- counts_of(spec$accession)
  m <- live(seqout_matrix(counts, sample = spec$samples[[1]]))

  expect_true(all(c("symbol", "feature_type") %in% names(m$var)))
  expect_setequal(unique(m$var$feature_type), c("Gene Expression", "Peaks"))
})
