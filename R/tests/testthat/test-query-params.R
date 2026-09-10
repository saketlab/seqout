# Check query parameter validation.
# The API ignores unknown parameters and returns an unfiltered result.

test_that("an unknown parameter is refused, not passed on", {
  expect_error(
    seqout:::.check_query_params("kind", c("min_evidence", "limit"), "/x"),
    "not a parameter"
  )
})

test_that("the error says why silence would have been worse", {
  expect_error(
    seqout:::.check_query_params("nope", c("limit"), "/x"),
    "unfiltered"
  )
})

test_that("a near miss is suggested", {
  expect_error(
    seqout:::.check_query_params("offsets", c("limit", "offset"), "/x"),
    "offset"
  )
})

test_that("accepted parameters pass, and NULL ones are ignored", {
  expect_null(seqout:::.check_query_params(
    c("limit", "offset"), c("limit", "offset", "min_evidence"), "/x"
  ))
  expect_null(seqout:::.check_query_params(character(0), c("limit"), "/x"))
})

test_that("single_cell_studies refuses a parameter the endpoint ignores", {
  # kind appears in responses but the endpoint ignores it as a filter.
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      args <- list(...)
      if (!is.null(.accepts)) {
        seqout:::.check_query_params(names(args), .accepts, path)
      }
      list(studies = list())
    }
  )
  expect_error(
    seqout:::.api_get(
      fake_con(backend = "api"), "/single-cell/studies",
      kind = "matrix_only", limit = 5,
      .accepts = seqout:::.pnt_studies_params
    ),
    "kind"
  )
})

test_that("a call with no .accepts is left alone", {
  # most endpoints fix their parameters in the code above them
  local_mocked_bindings(
    .api_get = function(con, path, ..., null_on = integer(0), .accepts = NULL) {
      expect_null(.accepts)
      list(ok = TRUE)
    }
  )
  expect_true(seqout:::.api_get(fake_con(backend = "api"), "/x")$ok)
})
