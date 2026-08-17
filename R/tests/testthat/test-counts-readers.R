skip_if_no <- function(pkg) skip_if_not_installed(pkg)

test_that("a 10x triplet reads as observations by features", {
  skip_if_no("Matrix")
  dir <- withr::local_tempdir()
  m <- Matrix::Matrix(c(1, 0, 0, 2, 3, 0, 0, 4, 5, 0, 6, 0), nrow = 3, sparse = TRUE)
  Matrix::writeMM(m, file.path(dir, "matrix.mtx"))
  writeLines(
    paste0("AAACCTGAGAAACC", c("AT", "GC", "TT", "GG"), "-1"),
    file.path(dir, "barcodes.tsv")
  )
  writeLines(c("GeneA", "GeneB", "GeneC"), file.path(dir, "features.tsv"))

  res <- seqout:::.read_10x_mtx(
    file.path(dir, "matrix.mtx"), file.path(dir, "barcodes.tsv"),
    file.path(dir, "features.tsv")
  )
  expect_equal(dim(res$X), c(4L, 3L))
  expect_equal(rownames(res$var), c("GeneA", "GeneB", "GeneC"))
  expect_equal(sum(res$X), 21)
  expect_true(inherits(res$X, "CsparseMatrix"))
})

test_that("a header row in barcodes or features is dropped", {
  expect_equal(seqout:::.drop_label_headers(c("x", "AAAC", "CCCG")), c("AAAC", "CCCG"))
  expect_equal(seqout:::.drop_label_headers(c("Barcode", "AAAC")), "AAAC")
})

test_that("a delimited table is transposed to observations by features", {
  dir <- withr::local_tempdir()
  path <- file.path(dir, "counts.csv")
  utils::write.csv(
    data.frame(gene = c("A", "B"), S1 = c(1, 4), S2 = c(2, 5), S3 = c(3, 6)),
    path,
    row.names = FALSE
  )
  res <- seqout:::.read_table(path)
  expect_equal(rownames(res$obs), c("S1", "S2", "S3"))
  expect_equal(rownames(res$var), c("A", "B"))
  expect_equal(dim(res$X), c(3L, 2L))
})

test_that("a gzipped table reads the same as a plain one", {
  dir <- withr::local_tempdir()
  path <- file.path(dir, "counts.csv.gz")
  con <- gzfile(path, "wt")
  writeLines(c("gene,S1,S2", "A,1,2", "B,3,4"), con)
  close(con)
  res <- seqout:::.read_table(path)
  expect_equal(dim(res$X), c(2L, 2L))
})

test_that("an rds holding a sparse matrix reads and is transposed", {
  skip_if_no("Matrix")
  dir <- withr::local_tempdir()
  m <- Matrix::Matrix(c(1, 0, 0, 2, 3, 0), nrow = 2, sparse = TRUE)
  path <- file.path(dir, "m.rds")
  saveRDS(m, path)
  res <- seqout:::.read_rds(path)
  expect_equal(dim(res$X), rev(dim(m)))
})

test_that("a CellRanger h5 reads, and feature_type filters it", {
  skip_if_no("hdf5r")
  skip_if_no("Matrix")
  dir <- withr::local_tempdir()
  path <- file.path(dir, "m.h5")
  h5 <- hdf5r::H5File$new(path, mode = "w")
  grp <- h5$create_group("matrix")
  grp[["data"]] <- c(1, 2, 3, 4, 5, 6)
  grp[["indices"]] <- as.integer(c(0, 1, 0, 2, 1, 2))
  grp[["indptr"]] <- as.integer(c(0, 2, 4, 6))
  grp[["shape"]] <- as.integer(c(3, 3))
  grp[["barcodes"]] <- paste0("AAACCTGAGAAACC", c("AT", "GC", "TT"), "-1")
  features <- grp$create_group("features")
  features[["name"]] <- c("GeneA", "GeneB", "GeneC")
  features[["feature_type"]] <- c("Gene Expression", "Gene Expression", "Antibody Capture")
  h5$close_all()

  res <- seqout:::.read_10x_h5(path)
  expect_equal(dim(res$X), c(3L, 3L))

  rna <- seqout:::.read_10x_h5(path, feature_type = "Gene Expression")
  expect_equal(rownames(rna$var), c("GeneA", "GeneB"))
})

test_that("an h5ad reads, including its categorical obs columns", {
  skip_if_no("hdf5r")
  skip_if_no("Matrix")
  dir <- withr::local_tempdir()
  path <- file.path(dir, "a.h5ad")
  h5 <- hdf5r::H5File$new(path, mode = "w")
  x <- h5$create_group("X")
  hdf5r::h5attr(x, "encoding-type") <- "csr_matrix"
  x[["data"]] <- c(1, 2, 3, 4)
  x[["indices"]] <- as.integer(c(0, 1, 1, 2))
  x[["indptr"]] <- as.integer(c(0, 2, 3, 4))
  obs <- h5$create_group("obs")
  hdf5r::h5attr(obs, "_index") <- "_index"
  obs[["_index"]] <- c("cell1", "cell2", "cell3")
  celltype <- obs$create_group("celltype")
  celltype[["codes"]] <- as.integer(c(0, 1, 0))
  celltype[["categories"]] <- c("Tcell", "Bcell")
  var <- h5$create_group("var")
  hdf5r::h5attr(var, "_index") <- "_index"
  var[["_index"]] <- c("G1", "G2", "G3")
  h5$close_all()

  res <- seqout:::.read_h5ad(path)
  expect_equal(dim(res$X), c(3L, 3L))
  expect_equal(rownames(res$obs), c("cell1", "cell2", "cell3"))
  expect_equal(res$obs$celltype, c("Tcell", "Bcell", "Tcell"))
  expect_equal(rownames(res$var), c("G1", "G2", "G3"))
})

test_that("a whitespace-delimited table with a short header reads", {
  dir <- withr::local_tempdir()
  path <- file.path(dir, "counts.txt.gz")
  con <- gzfile(path, "wt")
  # write.table() output: quoted names, no corner cell on the header.
  writeLines(c('"C1" "C2" "C3"', '"GeneA" 1 2 3', '"GeneB" 4 5 6'), con)
  close(con)
  res <- seqout:::.read_table(path)
  expect_equal(rownames(res$obs), c("C1", "C2", "C3"))
  expect_equal(rownames(res$var), c("GeneA", "GeneB"))
  expect_equal(dim(res$X), c(3L, 2L))
})

test_that("a tar expands to the readable unit inside it", {
  skip_if_no("Matrix")
  dir <- withr::local_tempdir()

  # A tar holding one 10x triplet, the shape GEO ships as GSE..._RAW.tar.
  inner <- file.path(dir, "GSM1_hpc")
  dir.create(inner)
  m <- Matrix::Matrix(c(1, 0, 0, 2, 3, 0, 0, 4, 5, 0, 6, 0), nrow = 3, sparse = TRUE)
  Matrix::writeMM(m, file.path(inner, "matrix.mtx"))
  writeLines(paste0("AAACCTGAGAAACC", c("AT", "GC", "TT", "GG"), "-1"),
             file.path(inner, "barcodes.tsv"))
  writeLines(c("GeneA", "GeneB", "GeneC"), file.path(inner, "features.tsv"))
  writeLines("readme", file.path(inner, "notes.pdf"))  # a member with no role

  tar_path <- file.path(dir, "GSM1_hpc.tar")
  withr::with_dir(dir, utils::tar(tar_path, "GSM1_hpc"))

  cache <- withr::local_tempdir()
  file.copy(tar_path, file.path(cache, "GSM1_hpc.tar"))
  counts <- list(accession = "GSE1", assay = "rna", cache_dir = cache)
  unit <- list(
    label = "GSM1", fmt = "tar", sample = "GSM1",
    files = list(list(url = file.path(cache, "GSM1_hpc.tar"),
                      role = "tar", name = "GSM1_hpc.tar")),
    metadata_files = list()
  )

  expanded <- seqout:::.expand_tar(counts, unit)
  expect_equal(expanded$fmt, "10x_mtx")
  expect_setequal(vapply(expanded$files, function(f) f$role, character(1)),
                  c("mtx", "barcodes", "features"))

  # Extracting once is enough; a second call reuses the marker directory.
  expect_true(dir.exists(paste0(file.path(cache, "GSM1_hpc.tar"), ".extracted")))
  expect_equal(seqout:::.expand_tar(counts, unit)$fmt, "10x_mtx")
})

test_that("a tar with nothing readable inside is an error, not an empty unit", {
  dir <- withr::local_tempdir()
  inner <- file.path(dir, "GSM2")
  dir.create(inner)
  writeLines("readme", file.path(inner, "notes.pdf"))
  tar_path <- file.path(dir, "GSM2.tar")
  withr::with_dir(dir, utils::tar(tar_path, "GSM2"))

  cache <- withr::local_tempdir()
  file.copy(tar_path, file.path(cache, "GSM2.tar"))
  counts <- list(accession = "GSE2", assay = "rna", cache_dir = cache)
  unit <- list(
    label = "GSM2", fmt = "tar", sample = "GSM2",
    files = list(list(url = file.path(cache, "GSM2.tar"), role = "tar", name = "GSM2.tar")),
    metadata_files = list()
  )
  expect_error(seqout:::.expand_tar(counts, unit), "no readable matrix inside")
})
