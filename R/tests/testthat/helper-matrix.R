mock_matrix <- function(X,
                        obs = data.frame(row.names = colnames(X)),
                        var = data.frame(row.names = rownames(X))) {
  structure(list(X = X, obs = obs, var = var), class = "seqout_matrix")
}

# Sparse counts avoid Seurat coercion warnings.
demo_X <- function() {
  X <- Matrix::Matrix(1:6, nrow = 3, ncol = 2, sparse = TRUE)
  dimnames(X) <- list(c("g1", "g2", "g3"), c("c1", "c2"))
  X
}

demo_obs <- function() {
  data.frame(group = c("a", "b"), row.names = c("c1", "c2"))
}

demo_var <- function() {
  data.frame(symbol = c("A", "B", "C"), row.names = c("g1", "g2", "g3"))
}

mock_counts <- function(accession = "GSE1") {
  handle <- list(accession = accession, cache_dir = tempdir())
  structure(
    tibble::tibble(unit = character(), sample = character(), preferred = logical()),
    class = c("seqout_counts", "tbl_df", "tbl", "data.frame"),
    .counts_handle = handle
  )
}
