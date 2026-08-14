rest_con <- function() seqout_connect("api", quiet = TRUE)

test_that("a search needs a query or at least one filter", {
  expect_error(seqout_search(con = rest_con()), "at least one filter")
})

test_that("an unknown filter is refused, with the valid set listed", {
  expect_error(
    seqout_search("liver", min_samples = 10, con = rest_con()),
    "min_samples"
  )
  expect_error(
    seqout_search("liver", assay = "RNA-seq", con = rest_con()),
    "not a search filter"
  )
})

test_that("filters must be named", {
  expect_error(seqout_search("liver", "geo", con = rest_con()), "must be named")
})

test_that("the filter set is exactly what the Python client accepts", {
  expect_setequal(seqout:::.search_filters, c(
    # SearchParams
    "db", "organism", "library_strategy", "library_source", "platform",
    "date_from", "date_to",
    # StructuredSearchParams
    "source", "country", "center", "journal", "instrument_model",
    "year_from", "year_to", "multi_platform", "assay_l1", "assay_l2",
    "geo_country_code_iso2", "geo_lat", "geo_lng", "geo_radius_km"
  ))
})

test_that("search is REST only; Parquet is pointed at query()", {
  expect_error(
    seqout_search("liver", con = seqout_connect("parquet", quiet = TRUE)),
    "query"
  )
})

test_that("mixing full-text-only and structured-only filters is an error", {
  expect_error(
    seqout_search("liver",
      date_from = "2020-01-01", journal = "Nature",
      con = rest_con()
    ),
    "date_from"
  )
})

test_that("dates are validated before they leave R", {
  expect_error(
    seqout_search("liver", date_from = "2020", con = rest_con()),
    "yyyy-mm-dd"
  )
  expect_error(
    seqout_search("liver", date_from = as.Date("2020-01-01"), con = rest_con()),
    "yyyy-mm-dd"
  )
})

test_that("the endpoint is chosen from the filters, not by the caller", {
  seen <- list()
  testthat::local_mocked_bindings(
    .paginate_api = function(con, path, params, max_pages = 1) {
      seen[[length(seen) + 1]] <<- list(
        path = path, params = params, max_pages = max_pages
      )
      tibble::tibble()
    }
  )

  seqout_search("liver", con = rest_con())
  seqout_search("liver", journal = "Nature", con = rest_con())
  seqout_search("liver", source = "geo", con = rest_con())
  seqout_search("liver", db = "geo", year_from = 2020, con = rest_con())

  expect_equal(seen[[1]]$path, "/search")
  expect_equal(seen[[2]]$path, "/search/structured")

  # db and source name the same thing; each endpoint gets its own spelling.
  expect_equal(seen[[3]]$path, "/search")
  expect_equal(seen[[3]]$params$db, "geo")

  expect_equal(seen[[4]]$path, "/search/structured")
  expect_equal(seen[[4]]$params$source, "geo")
  expect_null(seen[[4]]$params$db)
})

test_that("limit asks for only the pages it needs; no limit asks for all", {
  seen <- list()
  testthat::local_mocked_bindings(
    .paginate_api = function(con, path, params, max_pages = 1) {
      seen[[length(seen) + 1]] <<- max_pages
      tibble::tibble()
    }
  )
  seqout_search("liver", limit = 500, con = rest_con())
  seqout_search("liver", con = rest_con())
  expect_equal(seen[[1]], 3)
  expect_equal(seen[[2]], Inf)
})

test_that("paging maps the response's cursor names onto the request's", {
  # The server answers with rank/accession (or sort_value/accession); the
  # request spells them cursor_rank/cursor_acc/cursor_sort. Getting this wrong
  # leaves the cursor NULL and re-fetches page 1 forever.
  seen <- list()
  page <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      page <<- page + 1
      seen[[page]] <<- list(...)
      list(
        results = list(list(accession = paste0("GSE", page))),
        next_cursor = list(rank = 10 - page, accession = paste0("GSE", page)),
        total = 3, took_ms = 1
      )
    }
  )

  out <- seqout:::.paginate_api(fake_con(), "/search", list(q = "x"), max_pages = 3)
  expect_equal(out$accession, c("GSE1", "GSE2", "GSE3"))
  expect_null(seen[[1]]$cursor_acc)
  expect_equal(seen[[2]]$cursor_acc, "GSE1")
  expect_equal(as.numeric(seen[[2]]$cursor_rank), 9)
  expect_equal(seen[[3]]$cursor_acc, "GSE2")
})

test_that("an explicit sortby pages on sort_value, not rank", {
  seen <- list()
  page <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      page <<- page + 1
      seen[[page]] <<- list(...)
      list(
        results = list(list(accession = paste0("GSE", page))),
        next_cursor = list(sort_value = "42", accession = paste0("GSE", page))
      )
    }
  )
  seqout:::.paginate_api(fake_con(), "/search", list(q = "x"), max_pages = 2)
  expect_equal(seen[[2]]$cursor_sort, "42")
  expect_null(seen[[2]]$cursor_rank)
})

test_that("paging stops on an empty page rather than looping", {
  page <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      page <<- page + 1
      list(results = list(), next_cursor = list(rank = 1, accession = "GSE1"))
    }
  )
  out <- seqout:::.paginate_api(fake_con(), "/search", list(q = "x"), max_pages = Inf)
  expect_equal(nrow(out), 0)
  expect_equal(page, 1)
})

test_that("the rank cursor keeps full float8 precision", {
  # httr2 would format a bare double with getOption("digits") = 7 sig digits.
  # Rounded up that re-returns the boundary row; rounded down it skips rows.
  rank <- 0.57102183997631073
  seen <- list()
  page <- 0
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      page <<- page + 1
      seen[[page]] <<- list(...)
      list(
        results = list(list(accession = paste0("GSE", page))),
        next_cursor = list(rank = rank, accession = "GSE1")
      )
    }
  )
  seqout:::.paginate_api(fake_con(), "/search", list(q = "x"), max_pages = 2)

  expect_type(seen[[2]]$cursor_rank, "character")
  expect_identical(as.numeric(seen[[2]]$cursor_rank), rank)
  expect_false(identical(seen[[2]]$cursor_rank, format(rank)))
})
