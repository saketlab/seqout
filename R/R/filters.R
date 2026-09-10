#' The values a search filter can match
#'
#' Enumerates values accepted by [seqout_search()], with record counts.
#'
#' `list_assays()` returns both assay levels in a `level` column.
#' These functions read REST; [query()] can count from the dump.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param limit The maximum number of values. Only `list_journals()` and
#'   `list_centers()` take it.
#'
#' @return A tibble of values and counts.
#'
#' @seealso [seqout_search()].
#'
#' @name filter_values
#' @examples
#' \dontrun{
#' ListLibraryStrategies()
#'
#' # instrument_model values
#' ListInstrumentModels()
#'
#' # pass a value into search
#' top <- ListLibraryStrategies()$value[1]
#' SeqoutSearch("liver", library_strategy = top)
#'
#' # connection-first call
#' SeqoutConnect("api") |> ListJournals(limit = 20)
#' }
NULL

#' @rdname filter_values
#' @export
list_library_strategies <- function(con = .con()) {
  .filter_values(con, "list_library_strategies", "/filters/library-strategies")
}

#' @rdname filter_values
#' @export
list_instrument_models <- function(con = .con()) {
  .filter_values(con, "list_instrument_models", "/filters/instrument-models")
}

#' @rdname filter_values
#' @export
list_journals <- function(con = .con(), limit = 500) {
  .filter_values(con, "list_journals", "/filters/journals", limit = .cap(limit))
}

#' @rdname filter_values
#' @export
list_centers <- function(con = .con(), limit = 500) {
  .filter_values(con, "list_centers", "/filters/centers", limit = .cap(limit))
}

#' @param common_names Add a `common_name` column, `NA` where none is on record.
#'
#'   `list_organisms()` returns every organism recorded across archives.
#' @rdname filter_values
#' @export
list_organisms <- function(con = .con(), common_names = FALSE) {
  .need_api(con, "list_organisms")
  if (!rlang::is_bool(common_names)) {
    cli::cli_abort("{.arg common_names} must be {.code TRUE} or {.code FALSE}.")
  }
  res <- .api_get(
    con, "/organisms",
    common_names = if (common_names) "true" else "false"
  )
  if (common_names) {
    return(.pnt_tibble(
      res$organisms,
      list(scientific_name = .pnt_chr, common_name = .pnt_chr)
    ))
  }
  # bare strings would become one column per organism name
  tibble::tibble(
    scientific_name = as.character(unlist(res$organisms, use.names = FALSE))
  )
}

#' @param country Scope the assay counts to one country, by name. The default,
#'   `NULL`, counts over every archive.
#' @rdname filter_values
#' @export
list_assays <- function(con = .con(), country = NULL) {
  .need_api(con, "list_assays")
  res <- .api_get(con, "/stats/global-contribution-filters", country = country)
  .pnt_tibble(
    .labelled(res[c("assay_l1", "assay_l2")], "level"),
    list(level = .pnt_chr, value = .pnt_chr, count = .pnt_num)
  )
}

#' @rdname filter_values
#' @export
list_platforms <- function(con = .con()) {
  .need_api(con, "list_platforms")
  res <- .api_get(con, "/platforms")
  # name aliases platform.
  archives <- stats::setNames(rep(list(.pnt_num), length(.archives)), .archives)
  .pnt_tibble(
    res$platforms %||% list(),
    c(
      list(platform = .pnt_chr, display_name = .pnt_chr, total = .pnt_num),
      archives
    )
  )
}

#' The archives `/platforms` counts separately
#' @noRd
.archives <- c("geo", "sra", "ena", "gsa", "dra", "gea")

#' One `{total, values}` filter endpoint, as a tibble
#' @noRd
.filter_values <- function(con, what, path, ...) {
  .need_api(con, what)
  res <- .api_get(con, path, ...)
  .pnt_tibble(res$values %||% list(), list(value = .pnt_chr, count = .pnt_num))
}

#' Fold a `{group: records}` response into one list of records
#'
#' The group name becomes a field of every record it holds.
#' @noRd
.labelled <- function(groups, label) {
  unlist(
    lapply(names(groups), function(nm) {
      lapply(groups[[nm]], function(row) {
        row[[label]] <- nm
        row
      })
    }),
    recursive = FALSE
  )
}

#' `/filters/journals` and `/filters/centers` both declare `le=5000`.
#' @noRd
.filter_limit_max <- 5000L

#' Refuse the server ceiling before a 422
#'
#' Clamping would make a short result look complete.
#' @noRd
.cap <- function(limit, max = .filter_limit_max) {
  ok <- (rlang::is_scalar_double(limit) || rlang::is_scalar_integer(limit)) &&
    !is.na(limit) && limit >= 1 && limit <= max
  if (!ok) {
    cli::cli_abort("{.arg limit} must be one number between 1 and {max}.")
  }
  as.integer(limit)
}
