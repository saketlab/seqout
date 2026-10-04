#' Check that the Seqout API is reachable
#'
#' Asks the REST root once per session with a short timeout, so scripts,
#' examples and vignettes can skip cleanly while the service is down instead
#' of failing on their first query.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#'
#' @return `TRUE` when the API answered, `FALSE` otherwise.
#'
#' @export
#' @examples
#' SeqoutOnline()
seqout_online <- function(con = .con()) {
  .check_connection(con)
  .api_reachable(con$api_url)
}

#' @noRd
.api_reachable <- local({
  seen <- list()
  function(url) {
    if (is.null(seen[[url]])) {
      seen[[url]] <<- curl::has_internet() && tryCatch(
        {
          # one try: a down service should not stall a skip for the retry backoff
          resp <- .build_request(list(api_url = url), NULL, timeout = 10) |>
            httr2::req_retry(max_tries = 1) |>
            httr2::req_perform()
          httr2::resp_status(resp) < 400
        },
        error = function(e) FALSE
      )
    }
    seen[[url]]
  }
})
