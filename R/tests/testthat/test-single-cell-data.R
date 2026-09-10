# Only data = "matrix" is a server-side filter, so offset counts server rows
# while limit counts the rows surviving the filter.

kinds <- c("matrix_and_reads", "matrix_reads_unscanned", "matrix_only", "reads_only")

studies_page <- function(offset, size, total = 400, require_matrix = FALSE) {
  n <- max(0, min(size, total - offset))
  rows <- lapply(seq_len(n), function(i) {
    idx <- offset + i
    k <- kinds[[(idx - 1) %% 4 + 1]]
    if (require_matrix && k == "reads_only") k <- "matrix_only"
    list(study_accession = paste0("GSE", idx), kind = k)
  })
  list(studies = rows)
}

mock_studies <- function(total = 400) {
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      if (!is.null(.accepts)) {
        seqout:::.check_query_params(names(args), .accepts, path)
      }
      studies_page(args$offset, args$limit, total, isTRUE(args$require_matrix))
    },
    .env = parent.frame()
  )
}

api <- function() fake_con(backend = "api")

test_that("the default restricts nothing", {
  seen <- NULL
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      seen <<- args$require_matrix
      studies_page(args$offset, args$limit, 40, isTRUE(args$require_matrix))
    }
  )
  out <- suppressWarnings(single_cell_studies(con = api()))
  expect_false(seen)
  expect_true("reads_only" %in% out$kind)
})

test_that("an unrestricted result says how much of it has no matrix", {
  # Warn when results include studies without parsed matrices.
  mock_studies(total = 40)
  expect_warning(single_cell_studies(con = api()), "reads_only")
  expect_warning(single_cell_studies(con = api()), "10 of 40")
})

test_that("data = 'matrix' asks the server to drop reads_only", {
  seen <- NULL
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      seen <<- args$require_matrix
      studies_page(args$offset, args$limit, 40, isTRUE(args$require_matrix))
    }
  )
  out <- single_cell_studies(con = api(), data = "matrix")
  expect_true(seen)
  expect_false("reads_only" %in% out$kind)
})

test_that("only the unrestricted default warns", {
  mock_studies(total = 40)
  expect_no_warning(single_cell_studies(con = api(), data = "matrix"))
  # "fastq" selects reads_only, so warning about it would be noise
  expect_no_warning(single_cell_studies(con = api(), data = "fastq"))
  expect_no_warning(single_cell_studies(con = api(), data = "both"))
})

test_that("no warning when an unrestricted result happens to have no reads_only", {
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      n <- max(0, min(args$limit, 20 - args$offset))
      rows <- lapply(seq_len(n), function(i) {
        list(study_accession = paste0("GSE", args$offset + i), kind = "matrix_only")
      })
      list(studies = rows)
    }
  )
  expect_no_warning(single_cell_studies(con = api()))
})

test_that("data = 'fastq' keeps reads_only and drops matrix_only", {
  mock_studies()
  out <- single_cell_studies(con = api(), data = "fastq")
  expect_true(all(out$kind %in%
    c("matrix_and_reads", "matrix_reads_unscanned", "reads_only")))
  expect_true("reads_only" %in% out$kind)
  expect_false("matrix_only" %in% out$kind)
})

test_that("data = 'both' keeps only the studies confirmed to have each", {
  mock_studies()
  out <- single_cell_studies(con = api(), data = "both")
  expect_setequal(
    unique(out$kind),
    c("matrix_and_reads", "matrix_reads_unscanned")
  )
})

test_that("limit counts rows that survive the filter, not rows fetched", {
  # filtering after the page is read makes every page look short; a naive loop
  # stops at the first
  mock_studies()
  out <- single_cell_studies(con = api(), data = "fastq", limit = 150)
  expect_equal(nrow(out), 150)
  expect_true(all(out$kind != "matrix_only"))
})

test_that("a filtered read walks past the first page", {
  offsets <- integer(0)
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      offsets <<- c(offsets, args$offset)
      studies_page(args$offset, args$limit, 2500, isTRUE(args$require_matrix))
    }
  )
  out <- single_cell_studies(con = api(), data = "fastq")
  expect_gt(length(offsets), 1)
  expect_equal(offsets[1:3], c(0, 1000, 2000))
  # fastq keeps kinds with linked reads.
  expect_equal(nrow(out), 2500 / 4 * 3)
})

test_that("an unknown data value is refused", {
  expect_error(single_cell_studies(con = api(), data = "matrices"), "arg")
})

test_that("an empty result is still the right shape", {
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      list(studies = list())
    }
  )
  out <- single_cell_studies(con = api(), data = "fastq")
  expect_equal(nrow(out), 0)
  expect_true("kind" %in% names(out))
})

test_that("a page that survives the filter entirely empty still terminates", {
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      n <- max(0, min(args$limit, 300 - args$offset))
      rows <- lapply(seq_len(n), function(i) {
        list(study_accession = paste0("GSE", args$offset + i), kind = "matrix_only")
      })
      list(studies = rows)
    }
  )
  out <- single_cell_studies(con = api(), data = "fastq")
  expect_equal(nrow(out), 0)
})
