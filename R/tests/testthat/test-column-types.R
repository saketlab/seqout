# Check scalar types after record flattening.
# The string "FALSE" is truthy in R, so logical columns must retain their type.

test_that("a boolean column arrives as a logical", {
  out <- seqout:::.records_to_tibble(list(
    list(accession = "GSE1", is_single_cell = TRUE),
    list(accession = "GSE2", is_single_cell = FALSE),
    list(accession = "GSE3", is_single_cell = NULL)
  ))
  expect_type(out$is_single_cell, "logical")
  expect_identical(out$is_single_cell, c(TRUE, FALSE, NA))
})

test_that("the flattened string form is coerced too", {
  # the shape the API sends once .flatten_value has run
  out <- seqout:::.records_to_tibble(list(
    list(is_single_cell = "TRUE"), list(is_single_cell = "FALSE")
  ))
  expect_identical(out$is_single_cell, c(TRUE, FALSE))
})

test_that("a logical column can be filtered on without coercion", {
  out <- seqout:::.records_to_tibble(list(
    list(accession = "GSE1", is_single_cell = TRUE),
    list(accession = "GSE2", is_single_cell = FALSE)
  ))
  expect_equal(nrow(out[out$is_single_cell %in% TRUE, ]), 1)
})

test_that("every declared boolean column is covered", {
  recs <- list(stats::setNames(
    as.list(rep(TRUE, length(seqout:::.lgl_columns))),
    seqout:::.lgl_columns
  ))
  out <- seqout:::.records_to_tibble(recs)
  for (nm in seqout:::.lgl_columns) {
    expect_type(out[[nm]], "logical")
  }
})

test_that("columns that are not booleans stay character", {
  out <- seqout:::.records_to_tibble(list(
    list(accession = "GSE1", single_cell_status = "measured_single_cell")
  ))
  expect_type(out$single_cell_status, "character")
})

test_that("a structured column is still left as a list", {
  out <- seqout:::.records_to_tibble(list(
    list(accession = "GSE1", detections = list(list(organism = "HBV")))
  ))
  expect_type(out$detections, "list")
})
