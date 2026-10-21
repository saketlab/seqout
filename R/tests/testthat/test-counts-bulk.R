rows_126848 <- data.frame(
  accession = c("GSM1", "GSM2", "GSM3"),
  title = c("NAFL_1", "NAFL_2", "Obese_1"),
  description = c("869", "872", "2683"),
  disease = c("NAFLD", "NAFLD", "obese")
)

test_that("series columns map to GSMs through a one-to-one field", {
  # GEO drops the leading zero the matrix header keeps
  expect_equal(seqout:::.match_gsm(c("0869", "2683"), rows_126848), c("GSM1", "GSM3"))
  expect_equal(seqout:::.match_gsm(c("NAFL_2"), rows_126848), "GSM2")
})

test_that("an ambiguous or partial match maps nothing", {
  expect_null(seqout:::.match_gsm(c("NAFLD"), rows_126848))
  expect_null(seqout:::.match_gsm(c("0869", "9999"), rows_126848))
})

test_that("a lone series unit keeps its header names", {
  X <- Matrix::Matrix(1:4, 2, 2, sparse = TRUE, dimnames = list(c("g1", "g2"), c("0869", "0872")))
  out <- seqout:::.bind_units(list(mock_matrix(X)), labels = "GSE1_counts.txt.gz", keep_names = TRUE)
  expect_equal(colnames(out$X), c("0869", "0872"))
})

test_that("a unit already named by its GSM is not prefixed again", {
  # .read_unit names a one-column bulk unit for its GSM
  one <- function(gsm) {
    X <- Matrix::Matrix(1:2, 2, 1, sparse = TRUE, dimnames = list(c("g1", "g2"), gsm))
    m <- mock_matrix(X, obs = data.frame(label = paste0(gsm, "_S1"), row.names = gsm))
    m$sample <- gsm
    m
  }
  out <- seqout:::.bind_units(list(one("GSM1"), one("GSM2")))
  expect_equal(colnames(out$X), c("GSM1", "GSM2"))
  expect_equal(out$obs$label, c("GSM1_S1", "GSM2_S1"))
})

test_that("Agilent Feature Extraction output is named, not read as an empty matrix", {
  path <- withr::local_tempfile(fileext = ".txt")
  writeLines(c("TYPE\ttext\tinteger", "FEPARAMS\tProtocol_Name\tScan_NumChannels", "DATA\tGE1\t1"), path)
  expect_error(seqout:::.read_table(path), "Agilent Feature Extraction")
})

test_that("a per-sample bulk series names columns by GSM and joins characteristics", {
  skip_unless_live()
  skip_if_not_installed("SingleCellExperiment")

  se <- suppressMessages(Seqout2SCE(
    counts_of("GSE135251"),
    sample = c("GSM3998167", "GSM3998168"), sample_metadata = TRUE
  ))
  cd <- SummarizedExperiment::colData(se)
  expect_equal(dim(se), c(64253L, 2L))
  expect_equal(colnames(se), c("GSM3998167", "GSM3998168"))
  expect_equal(cd$label, c("GSM3998167_017-Ann-Daly_S1", "GSM3998168_018-Ann-Daly_S2"))
  expect_false(anyNA(cd$disease))
})

test_that("a series-level bulk matrix maps its columns to GSMs", {
  skip_unless_live()
  skip_if_not_installed("SingleCellExperiment")

  se <- suppressMessages(Seqout2SCE(counts_of("GSE126848"), sample_metadata = TRUE))
  cd <- SummarizedExperiment::colData(se)
  # the Python client asserts the same dims and names
  expect_equal(dim(se), c(19786L, 57L))
  expect_equal(colnames(se)[1:2], c("GSM3615324", "GSM3615338"))
  expect_equal(cd$label[1:2], c("0869", "0872"))
  expect_equal(rownames(se)[c(1, 19786)], c("ENSG00000186092", "ENSG00000160310"))
  expect_true(all(grepl("^GSM", colnames(se))))
  expect_false(anyNA(cd$disease))
})

test_that("SeqoutUnits returns one row per unit, not the internal list", {
  file <- function(name) list(url = paste0("https://x/", name), role = "table", name = name)
  unit <- function(gsm, preferred = TRUE) {
    list(
      label = gsm, fmt = "table", files = list(file(paste0(gsm, "_counts.txt.gz"))),
      sample = gsm, platform = "GPL1", preferred = preferred, metadata_files = list()
    )
  }
  cache <- new.env()
  assign("units", list(unit("GSM1"), unit("GSM2"), unit("GSM2b", FALSE)), envir = cache)
  counts <- mock_counts()
  attr(counts, ".counts_handle")$cache <- cache

  out <- SeqoutUnits(counts)
  expect_s3_class(out, "tbl_df")
  expect_equal(out$unit, c("GSM1", "GSM2"))
  expect_equal(out$files, c("GSM1_counts.txt.gz", "GSM2_counts.txt.gz"))
  expect_equal(nrow(SeqoutUnits(counts, preferred_only = FALSE)), 3L)
})
