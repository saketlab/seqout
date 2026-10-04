example_dir <- system.file("extdata", "sex", package = "seqout")
read_example <- function(name, ...) {
  read.delim(file.path(example_dir, name), check.names = FALSE, ...)
}

test_that("bulk liver excerpt calls sex per sample at high confidence", {
  testthat::skip_if_not_installed("SexSeek")
  testthat::skip_if_not_installed("genevintage")
  liver <- as.matrix(read_example("GSE135251-liver-excerpt.tsv.gz", row.names = 1))
  calls <- SeqoutSex(liver, group = colnames(liver))
  expect_s3_class(calls, "seqout_sex")
  expect_identical(nrow(calls), ncol(liver))
  expect_true(all(calls$confidence == "high"))
  female <- c("GSM3998216", "GSM3998217", "GSM3998218", "GSM3998220", "GSM3998191", "GSM3998208")
  male <- c("GSM3998201", "GSM3998214")
  expect_true(all(calls$verdict[calls$unit %in% female] == "female"))
  expect_true(all(calls$verdict[calls$unit %in% male] == "male"))
})

test_that("single-cell excerpt requires explicit species for symbol-only features", {
  testthat::skip_if_not_installed("SexSeek")
  testthat::skip_if_not_installed("genevintage")
  sc <- read_example("GSE229169-motor-cortex-excerpt.tsv.gz")
  to_matrix <- function(one_sample) {
    matrix(one_sample$count, ncol = 1, dimnames = list(one_sample$gene_id, one_sample$sample[1]))
  }
  macaque <- to_matrix(sc[sc$sample == "M1_mac3", ])
  expect_error(SeqoutSex(macaque), "Species could not be inferred")
  out <- SeqoutSex(macaque, species = "Macaca mulatta")
  expect_identical(out$verdict, "male")
  expect_identical(out$confidence, "medium")
})

test_that("single-cell excerpt calls human and mouse at high confidence via auto-detected species", {
  testthat::skip_if_not_installed("SexSeek")
  testthat::skip_if_not_installed("genevintage")
  sc <- read_example("GSE229169-motor-cortex-excerpt.tsv.gz")
  to_matrix <- function(one_sample) {
    matrix(one_sample$count, ncol = 1, dimnames = list(one_sample$gene_id, one_sample$sample[1]))
  }
  human <- SeqoutSex(to_matrix(sc[sc$sample == "M1_donor1", ]))
  mouse <- SeqoutSex(to_matrix(sc[sc$sample == "Mop_2C_rep1", ]))
  expect_identical(human$verdict, "male")
  expect_identical(human$confidence, "high")
  expect_identical(mouse$verdict, "male")
  expect_identical(mouse$confidence, "high")
})

test_that("marmoset abstains without an inactivation marker or enough Y evidence", {
  testthat::skip_if_not_installed("SexSeek")
  testthat::skip_if_not_installed("genevintage")
  sc <- read_example("GSE229169-motor-cortex-excerpt.tsv.gz")
  marmoset <- sc[sc$sample == "M1_Webster", ]
  x <- matrix(marmoset$count, ncol = 1, dimnames = list(marmoset$gene_id, "M1_Webster"))
  out <- SeqoutSex(x, species = "Callithrix jacchus")
  expect_identical(out$verdict, "uncertain")
  expect_true(grepl("no_inactivation_marker", out$flags))
})

test_that("SeqoutSexPlot returns a ggplot built from SeqoutSex output", {
  testthat::skip_if_not_installed("SexSeek")
  testthat::skip_if_not_installed("genevintage")
  testthat::skip_if_not_installed("ggplot2")
  liver <- as.matrix(read_example("GSE135251-liver-excerpt.tsv.gz", row.names = 1))
  calls <- SeqoutSex(liver, group = colnames(liver))
  p <- SeqoutSexPlot(calls)
  expect_s3_class(p, "ggplot")
  expect_error(SeqoutSexPlot(data.frame(x = 1)), "Pass the result")
})
