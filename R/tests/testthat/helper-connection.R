fake_con <- function(registered = character(0), backend = "parquet") {
  views <- new.env(parent = emptyenv())
  for (v in registered) assign(v, TRUE, envir = views)
  con <- new.env(parent = emptyenv())
  con$backend <- backend
  con$base_url <- "https://example.org"
  con$data_url <- "https://example.org/data"
  con$api_url <- "https://example.org/api"
  con$tables <- seqout:::.seqout_tables()
  con$views <- views
  con$read_only <- FALSE
  con$state <- new.env(parent = emptyenv())
  con$state$db <- structure(list(), class = "fake_duckdb")
  class(con) <- "seqout_connection"
  makeActiveBinding("db", function() con$state$db, con)
  con
}

#' A REST connection, for the argument checks that abort before any request
rest_con <- function() seqout_connect("api", quiet = TRUE)

#' Mock `.api_get` to replay `pages` in order for the calling test
#'
#' Calls past the last page get the last page again. Returns a function giving
#' each call's `...` params, in request order.
mock_pages <- function(pages, .env = parent.frame()) {
  seen <- list()
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen[[length(seen) + 1L]] <<- list(...)
      pages[[min(length(seen), length(pages))]]
    },
    .env = .env
  )
  function() seen
}

two_offset_pages <- list(
  list(total = 2, count = 1, offset = 0, results = list(list(study_accession = "GSE1"))),
  list(total = 2, count = 1, offset = 1, results = list(list(study_accession = "GSE2")))
)
