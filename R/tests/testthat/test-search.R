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

test_that("the filter set is the API's, less the names that meant two things", {
  # `year_from`/`year_to` bounded the publication year on one endpoint and
  # `updated_at` on the other, so `date_from`/`date_to` are the only time
  # bounds now. `center` is gone because `center_name` is on every result row.
  # The Python client still carries all three (models/api_models.py).
  expect_setequal(seqout:::.search_filters, c(
    "db", "source", "organism", "library_strategy", "library_source",
    "platform", "country", "journal", "instrument_model", "multi_platform",
    "date_from", "date_to",
    "assay_l1", "assay_l2",
    "geo_country_code_iso2", "geo_lat", "geo_lng", "geo_radius_km"
  ))
  expect_false(any(c("year_from", "year_to", "center") %in% seqout:::.search_filters))
})

test_that("search is REST only; Parquet is pointed at query()", {
  expect_error(
    seqout_search("liver", con = seqout_connect("parquet", quiet = TRUE)),
    "query"
  )
})

test_that("library_source is the one filter assay_l1 cannot be combined with", {
  expect_error(
    seqout_search("liver",
      library_source = "TRANSCRIPTOMIC", assay_l1 = "Transcriptomic",
      con = rest_con()
    ),
    "cannot be combined with"
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
  seqout_search("liver", journal = "Nature", country = "Japan", con = rest_con())
  seqout_search("liver", source = "geo", con = rest_con())
  seqout_search("liver", db = "geo", assay_l1 = "Transcriptomic", con = rest_con())

  expect_equal(seen[[1]]$path, "/search")

  # The website sends these to /search, so this package does too: routing them
  # to the structured endpoint changed what `country` meant.
  expect_equal(seen[[2]]$path, "/search")

  # db and source name the same thing; each endpoint gets its own spelling.
  expect_equal(seen[[3]]$path, "/search")
  expect_equal(seen[[3]]$params$db, "geo")

  expect_equal(seen[[4]]$path, "/search/structured")
  expect_equal(seen[[4]]$params$source, "geo")
  expect_null(seen[[4]]$params$db)
})

test_that("the day bounds survive a structured search, applied in R", {
  seen <- list()
  testthat::local_mocked_bindings(
    .paginate_api = function(con, path, params, max_pages = 1) {
      seen[[length(seen) + 1]] <<- list(path = path, params = params)
      tibble::tibble(
        accession = c("A", "B", "C"),
        updated_at = c("2023-06-01", "2024-06-01", "2025-06-01")
      )
    }
  )

  out <- seqout_search("liver",
    assay_l1 = "Transcriptomic", date_from = "2024-01-01",
    con = rest_con()
  )

  # Never sent: the endpoint has no such parameter and would drop it in silence.
  expect_null(seen[[1]]$params$date_from)
  expect_equal(seen[[1]]$path, "/search/structured")
  expect_equal(out$accession, c("B", "C"))
})

test_that("sortby reorders a structured search rather than being dropped", {
  testthat::local_mocked_bindings(
    .paginate_api = function(con, path, params, max_pages = 1) {
      expect_null(params$sortby)
      tibble::tibble(
        accession = c("A", "B", "C"),
        citation_count = c("7", "108", NA)
      )
    }
  )

  out <- seqout_search("liver",
    assay_l1 = "Transcriptomic", sortby = "citations",
    con = rest_con()
  )
  expect_equal(out$accession, c("B", "A", "C"))
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
