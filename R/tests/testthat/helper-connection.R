fake_con <- function(registered = character(0)) {
  views <- new.env(parent = emptyenv())
  for (v in registered) assign(v, TRUE, envir = views)
  con <- new.env(parent = emptyenv())
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
