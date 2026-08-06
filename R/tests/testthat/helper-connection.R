fake_con <- function(registered = character(0)) {
  views <- new.env(parent = emptyenv())
  for (v in registered) assign(v, TRUE, envir = views)
  structure(
    list(
      db = NULL, base_url = "https://example.org",
      data_url = "https://example.org/data",
      api_url = "https://example.org/api",
      tables = seqout:::.seqout_tables(), views = views
    ),
    class = "seqout_connection"
  )
}
