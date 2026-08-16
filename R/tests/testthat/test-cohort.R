test_that("an unknown filter is rejected, and the message names the near miss", {
  expect_error(
    sample_search(tisue = "liver", con = fake_con(backend = "api")),
    "tisue"
  )
  expect_error(
    sample_search(tisue = "liver", con = fake_con(backend = "api")),
    "tissue"
  )
})


test_that("a filter given positionally is rejected", {
  expect_error(
    sample_search("liver", con = fake_con(backend = "api")),
    "by name"
  )
})


test_that("no filter is an error rather than the whole corpus", {
  expect_error(
    sample_search(con = fake_con(backend = "api")),
    "at least one filter"
  )
})


test_that("a NULL filter does not count as a filter", {
  expect_error(
    sample_search(tissue = NULL, con = fake_con(backend = "api")),
    "at least one filter"
  )
})


test_that("sort and order are validated before the request", {
  expect_error(
    sample_search(
      tissue = "liver", sort = "; DROP TABLE",
      con = fake_con(backend = "api")
    ),
    "should be one of"
  )
  expect_error(
    sample_search(
      tissue = "liver", order = "sideways",
      con = fake_con(backend = "api")
    ),
    "should be one of"
  )
})


test_that("the Parquet backend refuses rather than returning a wrong answer", {
  expect_error(
    sample_search(tissue = "liver", con = fake_con(backend = "parquet")),
    "not in the dump"
  )
})


# Mock paging at the transport boundary.
# The returned closure needs a by-reference recorder.
.cohort_rec <- function() {
  e <- new.env(parent = emptyenv())
  e$requests <- list()
  e
}

.cohort_page_stub <- function(rec, total, cols = list()) {
  function(con, path, ...) {
    args <- list(...)
    rec$requests[[length(rec$requests) + 1]] <- c(
      offset = args$offset, limit = args$limit
    )
    n <- max(0, min(args$limit, total - args$offset))
    rows <- lapply(seq_len(n), function(i) {
      c(list(sample = paste0("GSM", args$offset + i)), cols)
    })
    nxt <- args$offset + n
    list(
      total = total, samples = rows, filters = list(tissue = "%liver%"),
      next_offset = if (nxt < total) nxt else NULL
    )
  }
}


test_that("no limit pages through the whole cohort", {
  rec <- .cohort_rec()
  local_mocked_bindings(.api_get = .cohort_page_stub(rec, total = 1200))
  out <- sample_search(tissue = "liver", con = fake_con(backend = "api"))
  expect_equal(nrow(out), 1200)
  expect_equal(attr(out, "total"), 1200L)
  expect_equal(vapply(rec$requests, `[[`, numeric(1), "offset"), c(0, 500, 1000))
})


test_that("a limit stops paging and never over-fetches", {
  rec <- .cohort_rec()
  local_mocked_bindings(.api_get = .cohort_page_stub(rec, total = 1200))
  out <- sample_search(tissue = "liver", limit = 600, con = fake_con(backend = "api"))
  expect_equal(nrow(out), 600)
  # The final request must not overfetch.
  expect_equal(vapply(rec$requests, `[[`, numeric(1), "limit"), c(500, 100))
})


test_that("a limit under one page is a single request", {
  rec <- .cohort_rec()
  local_mocked_bindings(.api_get = .cohort_page_stub(rec, total = 1200))
  out <- sample_search(tissue = "liver", limit = 30, con = fake_con(backend = "api"))
  expect_equal(nrow(out), 30)
  expect_length(rec$requests, 1)
  expect_equal(rec$requests[[1]][["limit"]], 30)
})


test_that("paging stops on an empty page rather than spinning", {
  rec <- .cohort_rec()
  local_mocked_bindings(
    .api_get = function(con, path, ...) {
      args <- list(...)
      rec$requests[[length(rec$requests) + 1]] <- args$offset
      # Simulate a stale total after rows run out.
      rows <- if (args$offset == 0) {
        lapply(seq_len(500), function(i) list(sample = paste0("GSM", i)))
      } else {
        list()
      }
      list(
        total = 9999, samples = rows, filters = list(),
        next_offset = args$offset + 500
      )
    }
  )
  out <- sample_search(tissue = "liver", con = fake_con(backend = "api"))
  expect_equal(nrow(out), 500)
  expect_length(rec$requests, 2)
})


test_that("numeric columns come back typed, so sort = 'cell_count' is usable", {
  rec <- .cohort_rec()
  local_mocked_bindings(.api_get = .cohort_page_stub(
    rec,
    total = 2,
    cols = list(cell_count = 14220L, age_days = 25567.5, has_viral_reads = TRUE)
  ))
  out <- sample_search(tissue = "liver", con = fake_con(backend = "api"))
  expect_type(out$cell_count, "integer")
  expect_type(out$age_days, "double")
  expect_type(out$has_viral_reads, "logical")
  expect_type(out$sample, "character")
})


test_that("the filter set matches the shared contract, name for name", {
  # Counts would miss a one-sided rename.
  path <- testthat::test_path("..", "..", "..", "schema", "cohort-filters.json")
  skip_if(!file.exists(path), "shared schema is outside the built package")

  schema <- jsonlite::fromJSON(path, simplifyVector = TRUE)
  expect_setequal(seqout:::.cohort_filters, schema$filters)
  expect_setequal(seqout:::.cohort_sortable, schema$sortable)
  expect_false(anyDuplicated(seqout:::.cohort_filters) > 0)
})


test_that("the returned spec covers what the server selects", {
  expect_true(all(
    c("sample", "study_accession", "cell_count", "age_days", "microbes") %in%
      names(seqout:::.cohort_spec())
  ))
  expect_false(anyDuplicated(names(seqout:::.cohort_spec())) > 0)
})
