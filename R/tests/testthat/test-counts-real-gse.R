# Manifest-level checks against real series. These list files and download none.

test_that("the real-GSE catalogue spans organisms, tissues and formats", {
  organisms <- unique(unlist(strsplit(
    vapply(gse_catalogue, `[[`, character(1), "organism"), "; "
  )))
  expect_true(all(c(
    "Homo sapiens", "Mus musculus", "Danio rerio", "Drosophila melanogaster",
    "Arabidopsis thaliana", "Caenorhabditis elegans", "Macaca mulatta",
    "Rattus norvegicus", "Sus scrofa", "Gallus gallus",
    "Saccharomyces cerevisiae", "Zea mays", "Xenopus laevis"
  ) %in% organisms))

  tissues <- tolower(paste(vapply(gse_catalogue, `[[`, character(1), "tissue"), collapse = " | "))
  expect_true(all(vapply(
    c(
      "brain", "heart", "kidney", "lung", "intestine", "muscle", "skin",
      "embryo", "root", "leaf", "tumor", "blood", "bone marrow"
    ),
    grepl, logical(1),
    x = tissues, fixed = TRUE
  )))

  formats <- sort(unique(unlist(lapply(gse_catalogue, `[[`, "formats"))))
  expect_true(all(c("10x_mtx", "10x_h5", "h5ad", "rds", "table", "tar") %in% formats))
})

test_that("every catalogued series matches its measured manifest envelope", {
  skip_unless_live()

  for (spec in gse_catalogue) {
    counts <- counts_of(spec$accession)
    n_samples <- length(unique(stats::na.omit(counts$sample)))

    expect_s3_class(counts, "seqout_counts")
    expect_gte(nrow(counts), spec$min_units)
    expect_gte(n_samples, spec$min_samples)
    expect_true(all(spec$formats %in% counts$format),
      info = paste(spec$accession, "formats:", paste(unique(counts$format), collapse = ","))
    )
  }
})

test_that("the manifest carries one preferred unit per sample", {
  skip_unless_live()

  for (spec in gse_with_modal("single")) {
    counts <- counts_of(spec$accession)
    keyed <- counts[!is.na(counts$sample), , drop = FALSE]
    if (nrow(keyed) == 0L) {
      next
    }
    per_sample <- tapply(keyed$preferred, keyed$sample, sum)
    expect_true(all(per_sample == 1L),
      info = paste(spec$accession, "preferred per sample:", paste(unique(per_sample), collapse = ","))
    )
  }
})

test_that("assay names the modality the file names carry", {
  skip_unless_live()

  for (spec in gse_with_assays()) {
    counts <- counts_of(spec$accession)
    found <- sort(unique(stats::na.omit(counts$assay)))

    expect_true(all(spec$assays %in% found),
      info = paste(spec$accession, "found:", paste(found, collapse = ","))
    )
    expect_true(all(found %in% c("rna", "adt", "hto", "atac")), info = spec$accession)
  }
})

test_that("assay is NA when no file name names a modality", {
  skip_unless_live()

  for (spec in Filter(function(x) isTRUE(x$only_na_assay), gse_catalogue)) {
    counts <- counts_of(spec$accession)
    expect_true(all(is.na(counts$assay)), info = spec$accession)
  }
})

test_that("a multimodal series pairs its modalities on the same sample", {
  skip_unless_live()

  for (spec in gse_with_modal("paired")) {
    counts <- counts_of(spec$accession)
    per_sample <- modalities_per_sample(counts)
    expect_gte(sum(per_sample > 1L), spec$multimodal_samples)
  }
})

test_that("modalities split across separate GSMs are not paired", {
  skip_unless_live()

  for (spec in gse_with_modal("split")) {
    counts <- counts_of(spec$accession)
    expect_null(seqout:::.modal_groups(counts),
      info = paste(spec$accession, "should stay single-assay")
    )
  }
})

test_that("modality words on series-level files do not make a multimodal object", {
  skip_unless_live()

  for (spec in gse_with_modal("series")) {
    counts <- counts_of(spec$accession)
    expect_null(seqout:::.modal_groups(counts), info = spec$accession)
  }
})

test_that("a single-modality series stays single-assay", {
  skip_unless_live()

  for (spec in gse_with_modal("single")) {
    counts <- counts_of(spec$accession)
    expect_null(seqout:::.modal_groups(counts), info = spec$accession)
  }
})

test_that("counts_samples narrows a series to the samples it can read", {
  skip_unless_live()

  counts <- counts_of("GSE297547")
  rows <- counts_samples(counts, min_cell_count = NULL)
  expect_true(all(c("unit", "format") %in% names(rows)))
  expect_true(all(rows$unit %in% counts$unit))
})

test_that("unit labels stay unique within a series", {
  skip_unless_live()

  for (spec in gse_catalogue) {
    counts <- counts_of(spec$accession)
    expect_false(anyDuplicated(counts$unit) > 0, info = spec$accession)
  }
})

test_that("a GSM resolves to the series that holds it", {
  skip_unless_live()

  counts <- live(seqout_counts("GSM8994520", assay = NULL))
  expect_gt(nrow(counts), 0)
  expect_true(all(counts$sample %in% c(NA_character_, "GSM8994520")))
})
