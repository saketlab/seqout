testthat::skip_if_not_installed("genevintage")

gene_map <- function() {
  data.frame(
    id = c(
      "ENSG00000141510", "ENSG00000012048", "ENSG00000184640",
      "ENSG00000145416"
    ),
    name = c("TP53", "BRCA1", "SEPTIN9", "MARCHF1"),
    chr = c("17", "17", "17", "4"), biotype = "protein_coding"
  )
}

gene_matrix <- function(ids) {
  matrix(seq_len(length(ids) * 2L),
    nrow = length(ids),
    dimnames = list(ids, c("s1", "s2"))
  )
}

test_that("versioned IDs map without losing rows or feature metadata", {
  X <- gene_matrix(c("ENSG00000141510.16", "ENSG00000012048", "unknown"))
  x <- mock_matrix(X, var = data.frame(
    symbol = c("old", "BRCA1", "unknown"),
    row.names = rownames(X)
  ))
  out <- SeqoutGeneNames(x, mapping = gene_map(), quiet = TRUE)
  expect_s3_class(out, "seqout_matrix")
  expect_identical(rownames(out$X), c("TP53", "BRCA1", "unknown"))
  expect_identical(rownames(out$var), rownames(out$X))
  expect_identical(out$var$symbol, x$var$symbol)
  expect_identical(out$obs, x$obs)
  expect_identical(unname(out$X), unname(X))
  expect_identical(rownames(x$X), rownames(X))
  report <- out$gene_annotation[[1]]
  expect_identical(report$features$status, c("mapped", "mapped", "unmapped"))
  expect_identical(report$features$input, rownames(X))
  expect_true(report$annotation$supplied_mapping)
})

test_that("duplicate names remain separate rows with an unsuffixed audit", {
  ids <- c("ENSG00000141510", "ENSG00000141510.16", "TP53", "TP53.1")
  out <- SeqoutGeneNames(mock_matrix(gene_matrix(ids)), mapping = gene_map(), quiet = TRUE)
  expect_identical(rownames(out$X), c("TP53", "TP53.2", "TP53.3", "TP53.1"))
  expect_identical(out$gene_annotation[[1]]$features$name, c("TP53", "TP53", "TP53", "TP53.1"))
  expect_identical(as.vector(out$X), seq_len(8L))
})

test_that("Excel correction uses the annotation and preserves ambiguous tokens", {
  map <- rbind(gene_map(), data.frame(
    id = c("another", "third"), name = c("SEPTIN3", "MARCHF9"),
    chr = "12", biotype = "protein_coding"
  ))
  ids <- c("9-Sep", "1-Mar", "TP53", "3/9/2017", "31-Feb", "2.31E+13")
  x <- mock_matrix(gene_matrix(ids))
  out <- SeqoutCorrectNames(x, mapping = map, quiet = TRUE)
  expect_identical(rownames(out$X), c("SEPTIN9", "MARCHF1", ids[3:6]))
  expect_identical(
    out$gene_annotation[[1]]$features$status,
    c("corrected", "corrected", "unchanged", "ambiguous", "unresolved", "unresolved")
  )
  old <- map
  old$name[old$name == "SEPTIN9"] <- "SEPT9"
  old$name[old$name == "MARCHF1"] <- "MARCH1"
  historical <- SeqoutCorrectNames(x, mapping = old, quiet = TRUE)
  expect_identical(rownames(historical$X)[1:2], c("SEPT9", "MARCH1"))
  expect_identical(unname(out$X), unname(x$X))
})

test_that("damaged feature columns and repeated corrections remain auditable", {
  x <- mock_matrix(gene_matrix(c("gene1", "gene2", "gene3")))
  x$var$symbol <- c("9-Sep", "9-Sep", "TP53")
  out <- SeqoutCorrectNames(x, ids = x$var$symbol, mapping = gene_map(), quiet = TRUE)
  expect_identical(rownames(out$X), c("SEPTIN9", "SEPTIN9.1", "TP53"))
  expect_identical(out$var$symbol, x$var$symbol)
  expect_identical(out$gene_annotation[[1]]$features$original, rownames(x$X))
  again <- SeqoutCorrectNames(out, mapping = gene_map(), quiet = TRUE)
  expect_identical(again$X, out$X)
  expect_length(again$gene_annotation, 2)
  expect_identical(again$gene_annotation[[1]], out$gene_annotation[[1]])
})

test_that("sparse counts stay valid through renaming and downstream operations", {
  skip_if_not_installed("Matrix")
  X <- methods::as(Matrix::Matrix(gene_matrix(c("9-Sep", "TP53", "1-Mar")),
    sparse = TRUE
  ), "dgCMatrix")
  for (x in list(X, mock_matrix(X))) {
    out <- SeqoutCorrectNames(x, mapping = gene_map(), quiet = TRUE)
    Y <- if (inherits(out, "seqout_matrix")) out$X else out
    expect_s4_class(Y, "dgCMatrix")
    expect_identical(Y@x, X@x)
    expect_identical(Y@i, X@i)
    expect_identical(Y@p, X@p)
    expect_true(methods::validObject(Y))
    expect_true(methods::validObject(Y[1:2, , drop = FALSE]))
    expect_true(methods::validObject(rbind(Y, Y)))
    expect_true(methods::validObject(Matrix::t(Y)))
    expect_equal(as.numeric(Y %*% c(1, 1)), as.numeric(X %*% c(1, 1)))
  }
})

test_that("invalid inputs fail before annotation downloads", {
  x <- gene_matrix(c("9-Sep", "TP53"))
  expect_error(SeqoutCorrectNames(x), "both")
  expect_error(SeqoutCorrectNames(x, species = "human"), "both")
  expect_error(SeqoutGeneNames(x, ids = "one"), "per matrix row")
  expect_error(SeqoutGeneNames(x, ids = c(NA, "TP53")), "non-missing")
  expect_error(SeqoutGeneNames(x, ids = c(" ", "TP53")), "non-empty")
  expect_error(SeqoutGeneNames(unname(x)), "per matrix row")
  expect_error(SeqoutGeneNames(data.frame(x)), "numeric matrix")
  expect_error(SeqoutGeneNames(matrix(numeric(), 0, 2), ids = character()), "no gene rows")
  bad <- mock_matrix(x)
  bad$var <- bad$var[2:1, , drop = FALSE]
  expect_error(SeqoutGeneNames(bad), "same row names")
  expect_error(SeqoutCorrectNames(x, mapping = data.frame(id = "x", name = "SEPT9")), "chr")
})

test_that("automatic detection passes choices through and records the result", {
  local_mocked_bindings(geneid2name = function(ids, species, release, assembly, source, quiet) {
    expect_null(species)
    expect_null(release)
    expect_null(assembly)
    expect_null(source)
    structure(c("TP53", "BRCA1"),
      mapped = c(TRUE, TRUE),
      species = "homo_sapiens", release = "116", assembly = "38", source = "ensembl"
    )
  }, .package = "genevintage")
  x <- mock_matrix(gene_matrix(c("ENSG00000141510", "ENSG00000012048")))
  out <- SeqoutGeneNames(x)
  expect_identical(rownames(out$X), c("TP53", "BRCA1"))
  expect_identical(out$gene_annotation[[1]]$annotation$release, "116")
  expect_false(out$gene_annotation[[1]]$annotation$supplied_mapping)
})

test_that("automatic renaming handles collisions without an irrelevant warning", {
  map <- data.frame(id = c("ENSG00000141510", "ENSG00000012048"), name = c("same", "same"))
  out <- expect_no_warning(SeqoutGeneNames(gene_matrix(map$id), mapping = map))
  expect_identical(rownames(out), c("same", "same.1"))
  map <- data.frame(id = c("ENSG00000141510", "ENSG00000141510"), name = c("one", "two"))
  expect_warning(SeqoutGeneNames(gene_matrix("ENSG00000141510"), mapping = map), "conflicting names")
})

test_that("bundled GEO examples retain original values and expected corrections", {
  dir <- system.file("extdata", "gene-names", package = "seqout")
  read <- function(f, ...) read.delim(file.path(dir, f), check.names = FALSE, ...)
  old <- as.matrix(read("GSE52529-excerpt.tsv.gz", row.names = 1))
  named <- SeqoutGeneNames(old, mapping = read("gencode17-excerpt.tsv.gz"))
  expect_identical(rownames(named)[1:4], c("TSPAN6", "TNMD", "DPM1", "SCYL3"))
  expect_identical(as.vector(old), as.vector(named))
  raw <- as.matrix(read("GSE101942-excerpt.tsv.gz", row.names = 1))
  fixed <- SeqoutCorrectNames(raw, mapping = read("ensembl116-excel.tsv.gz"), quiet = TRUE)
  report <- seqout_gene_report(fixed)
  expect_identical(sum(report$status == "corrected"), 25L)
  expect_identical(report$input[report$status == "unresolved"], "15-Sep")
  expect_identical(as.vector(raw), as.vector(fixed))
  historical <- SeqoutCorrectNames(raw, mapping = read("ensembl95-excel.tsv.gz"), quiet = TRUE)
  old_report <- seqout_gene_report(historical)
  expect_identical(old_report$name[match(c("1-Mar", "9-Sep"), old_report$input)], c("MARCH1", "SEPT9"))
  expect_identical(report$name[match(c("1-Mar", "9-Sep"), report$input)], c("MARCHF1", "SEPTIN9"))
})

test_that("seqout_gene_report reads the audit from either storage slot", {
  plain <- SeqoutGeneNames(gene_matrix(c("ENSG00000141510", "unknown")),
    mapping = gene_map(), quiet = TRUE
  )
  report <- seqout_gene_report(plain)
  expect_equal(report$status, c("mapped", "unmapped"))
  expect_equal(attr(report, "operation"), "gene_names")
  expect_true(attr(report, "annotation")$supplied_mapping)

  x <- mock_matrix(gene_matrix(c("9-Sep", "TP53")))
  once <- SeqoutCorrectNames(x, mapping = gene_map(), quiet = TRUE)
  twice <- SeqoutCorrectNames(once, mapping = gene_map(), quiet = TRUE)
  expect_identical(seqout_gene_report(once), seqout_gene_report(twice, which = 1))
  expect_equal(seqout_gene_report(twice)$input, c("SEPTIN9", "TP53"))
  expect_error(seqout_gene_report(gene_matrix("TP53")), "no gene-name audit")
})
