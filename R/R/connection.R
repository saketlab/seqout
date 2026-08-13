#' Connect to SeqOut
#'
#' `seqout` gets data in two ways. This function selects the way, and it points
#' at the server.
#'
#' Most code does not call it. Every function has `con` as its last argument,
#' and the default is the REST API at <https://seqout.org>. Call
#' `seqout_connect()` to select the Parquet backend, or to use another server.
#'
#' The two backends answer the same functions:
#'
#' * `"api"`, the default, reads <https://seqout.org> with HTTP. It is always
#'   current. It needs no other package, and it does not open DuckDB.
#' * `"parquet"` reads the Parquet dump with DuckDB through `httpfs`. It
#'   answers SQL, and it works offline against a local dump. It is slower over
#'   a remote URL, and it lags the live index. It needs the `duckdb` package.
#'
#' You must select the Parquet backend. The package does not change to it for
#' you, because one lookup would become a scan of many gigabytes.
#'
#' @param backend `"api"`, the default, or `"parquet"`. See the description.
#' @param base_url The address of the SeqOut server. The default is the
#'   `SEQOUT_BASE_URL` environment variable, or `"https://seqout.org"` when
#'   that variable is empty. The variable lets CI use an origin that is not
#'   behind the public CDN, with no change to the code.
#' @param read_only Make the DuckDB connection read-only. The default is
#'   `FALSE`, so that [cache_table()] can write views to local storage. The
#'   `"api"` backend ignores this argument.
#' @param eager Register every Parquet view now, and not at the first use. The
#'   `"api"` backend ignores this argument.
#' @param quiet Do not show the message at the start.
#'
#' @return A `seqout_connection` object.
#'
#' @export
#' @examples
#' \dontrun{
#' # The REST API is the default
#' project("GSE297547")
#'
#' # Select Parquet for SQL and for offline work
#' con <- seqout_connect("parquet")
#' query("SELECT * FROM geo_series LIMIT 5", con = con)
#' seqout_close(con)
#' }
seqout_connect <- function(backend = c("api", "parquet"),
                           base_url = Sys.getenv("SEQOUT_BASE_URL", "https://seqout.org"),
                           read_only = FALSE,
                           eager = FALSE,
                           quiet = FALSE) {
  backend <- match.arg(backend)
  base_url <- sub("/$", "", base_url)

  con <- new.env(parent = emptyenv())
  con$backend <- backend
  con$base_url <- base_url
  con$data_url <- paste0(base_url, "/data")
  con$api_url <- paste0(base_url, "/api")
  con$tables <- .seqout_tables()
  con$views <- new.env(parent = emptyenv())
  con$read_only <- read_only
  con$state <- new.env(parent = emptyenv())
  con$state$db <- NULL
  con$state$drv <- NULL
  class(con) <- "seqout_connection"

  makeActiveBinding("db", function() .duckdb(con), con)

  if (backend == "parquet" && eager) {
    .register_views(con, con$tables, progress = interactive())
  }

  if (!quiet) {
    if (backend == "api") {
      cli::cli_alert_success("SeqOut ({.url {base_url}}) \u2014 REST backend")
    } else {
      cli::cli_alert_success(
        "SeqOut ({.url {base_url}}) \u2014 Parquet backend, {length(con$tables)} table{?s}"
      )
    }
  }

  con
}

#' The connection used when a call does not name one
#'
#' Holds the process-wide default so `.con()` can hand the same REST connection
#' to every call without reopening it.
#' @noRd
.seqout_state <- new.env(parent = emptyenv())

#' Set the connection every function falls back to
#'
#' Call this once to make a Parquet connection the default for the session,
#' instead of passing `con =` to every call.
#'
#' @param con A `seqout_connection`, or `NULL` to go back to the built-in
#'   REST default.
#'
#' @return The previous default, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' seqout_default(seqout_connect("parquet"))
#' project("GSE297547") # now reads Parquet
#' seqout_default(NULL) # back to REST
#' }
seqout_default <- function(con) {
  if (!is.null(con)) .check_connection(con)
  old <- .seqout_state$default
  .seqout_state$default <- con
  invisible(old)
}

#' Resolve the connection for a call
#'
#' Every exported function defaults its `con` argument to `.con()`. The
#' argument is lazy, so the default connection is only built if a call actually
#' needs one -- loading the package opens nothing.
#' @noRd
.con <- function() {
  if (is.null(.seqout_state$default)) {
    .seqout_state$default <- seqout_connect("api", quiet = TRUE)
  }
  .seqout_state$default
}

#' Refuse a REST connection where only DuckDB can answer
#'
#' Some functions are SQL over the whole dump with no REST equivalent. Erroring
#' beats silently opening DuckDB: that would turn one call into a multi-gigabyte
#' scan the caller never asked for.
#' @noRd
.need_parquet <- function(con, what = NULL) {
  .check_connection(con)
  if (identical(con$backend, "parquet")) {
    return(invisible(con))
  }
  what <- what %||% as.character(sys.call(-1)[[1]])
  cli::cli_abort(c(
    "{.fn {what}} needs the Parquet backend; this connection is REST.",
    i = "Open one with {.code con <- seqout_connect(\"parquet\")}.",
    i = "Then pass {.code con = con}, or make it the default with {.code seqout_default(con)}."
  ))
}

#' Open the DuckDB handle, once, on first `con$db`
#' @noRd
.duckdb <- function(con) {
  if (!is.null(con$state$db)) {
    return(con$state$db)
  }
  .need_parquet(con, "This")
  rlang::check_installed(
    "duckdb",
    "to query the SeqOut Parquet tables (REST-only functions do not need it)."
  )

  drv <- duckdb::duckdb()
  db <- DBI::dbConnect(drv, read_only = con$read_only)

  for (ext in c("httpfs", "json")) {
    tryCatch(
      DBI::dbExecute(db, paste("LOAD", ext)),
      error = function(e) {
        tryCatch(
          {
            DBI::dbExecute(db, paste("INSTALL", ext))
            DBI::dbExecute(db, paste("LOAD", ext))
          },
          error = function(e2) {
            cli::cli_warn("Could not load DuckDB extension {.val {ext}}: {e2$message}")
          }
        )
      }
    )
  }
  DBI::dbExecute(db, "SET enable_http_metadata_cache = true")
  DBI::dbExecute(db, "SET enable_object_cache = true")

  con$state$drv <- drv
  con$state$db <- db
  db
}

#' Register the remote Parquet views
#'
#' Views are created on first reference, which keeps [seqout_connect()] quick.
#' Anything that reads the DuckDB catalog directly, such as `dplyr::tbl()`,
#' needs them to exist first.
#'
#' @param tables Which tables to register. Defaults to all of them.
#' @param progress Show a progress bar. Defaults to `TRUE` interactively.
#' @param con A Parquet `seqout_connection` from [seqout_connect()].
#'
#' @return The names of every registered view, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect("parquet")
#' register_tables("unified_metadata", con = con)
#' dplyr::tbl(con$db, "unified_metadata")
#' }
register_tables <- function(tables = NULL, progress = interactive(), con = .con()) {
  .need_parquet(con, "register_tables")
  tables <- tables %||% con$tables
  unknown <- setdiff(tables, con$tables)
  if (length(unknown) > 0) {
    cli::cli_abort("Not a SeqOut table: {.val {unknown}}.")
  }
  invisible(.register_views(con, tables, progress = progress))
}

#' Create any of `tables` that is not registered yet
#'
#' `con$views` is an environment, so a view registered through one copy of the
#' connection is visible from every other.
#' @noRd
.register_views <- function(con, tables, progress = FALSE) {
  pending <- setdiff(tables, ls(con$views))
  if (length(pending) == 0) {
    return(invisible(ls(con$views)))
  }
  .duckdb(con)
  if (progress) {
    cli::cli_progress_bar(
      format = "Registering {cli::pb_current}/{cli::pb_total} {.val {tbl}} {cli::pb_bar} {cli::pb_eta}",
      total = length(pending), clear = TRUE
    )
  }
  for (tbl in pending) {
    if (progress) cli::cli_progress_update()
    sql <- sprintf(
      "CREATE OR REPLACE VIEW %s AS SELECT * FROM read_parquet('%s/%s.parquet')",
      tbl, con$data_url, tbl
    )
    ok <- tryCatch(
      {
        DBI::dbExecute(con$db, sql)
        TRUE
      },
      error = function(e) {
        cli::cli_warn("Could not register view {.val {tbl}}: {e$message}")
        FALSE
      }
    )
    if (ok) assign(tbl, TRUE, envir = con$views)
  }
  if (progress) cli::cli_progress_done()
  invisible(ls(con$views))
}

#' Register the views a statement names, before DuckDB has to resolve them
#' @noRd
.ensure_views <- function(con, sql) {
  named <- con$tables[vapply(con$tables, grepl, logical(1), x = sql, fixed = TRUE)]
  invisible(.register_views(con, named))
}

#' Close a SeqOut connection
#'
#' Only the Parquet backend holds a resource worth closing; on a REST
#' connection this is a no-op.
#'
#' @param con A `seqout_connection` returned by [seqout_connect()].
#'
#' @export
seqout_close <- function(con = .con()) {
  .check_connection(con)
  if (!is.null(con$state$db)) {
    DBI::dbDisconnect(con$state$db, shutdown = TRUE)
    con$state$db <- NULL
    con$state$drv <- NULL
    rm(list = ls(con$views), envir = con$views)
  }
  cli::cli_alert_info("SeqOut connection closed.")
  invisible(NULL)
}

#' @export
close.seqout_connection <- function(con, ...) {
  seqout_close(con)
}

#' @export
print.seqout_connection <- function(x, ...) {
  if (identical(x$backend, "api")) {
    cli::cli_inform(c(
      "{.cls seqout_connection}",
      " " = "Backend:   REST",
      " " = "Server:    {.url {x$base_url}}"
    ))
    return(invisible(x))
  }

  status <- if (is.null(x$state$db)) {
    "idle (DuckDB opens on the first query)"
  } else {
    tryCatch(
      {
        DBI::dbGetQuery(x$state$db, "SELECT 1")
        "connected"
      },
      error = function(e) "disconnected"
    )
  }

  cli::cli_inform(c(
    "{.cls seqout_connection}",
    " " = "Backend:   Parquet",
    " " = "Server:    {.url {x$base_url}}",
    " " = "Status:    {status}",
    " " = "Tables:    {length(x$tables)}"
  ))
  invisible(x)
}

#' Keep in sync with EXPORT_TABLES in pysradb-server/scripts/export_parquet.py
#' and with _ALL_PARQUET_FILES in the Python client.
#' @noRd
.seqout_tables <- function() {
  c(
    "arrayexpress_experiments",
    "arrayexpress_samples",
    "dra_experiments",
    "dra_runs",
    "dra_samples",
    "dra_studies",
    "dra_submissions",
    "ena_experiments",
    "ena_samples",
    "ena_studies",
    "gea_experiments",
    "gea_samples",
    "geo_contributors",
    "geo_platforms",
    "geo_samples",
    "geo_series",
    "gsa_experiments",
    "gsa_projects",
    "gsa_samples",
    "gsa_studies",
    "pubmed_metadata",
    "run_download_links",
    "sra_experiments",
    "sra_runs",
    "sra_samples",
    "sra_studies",
    "sra_submissions",
    "unified_centers",
    "unified_metadata"
  )
}

#' @noRd
.check_connection <- function(con) {
  if (!inherits(con, "seqout_connection")) {
    cli::cli_abort(
      "{.arg con} must be a {.cls seqout_connection} (from {.fn seqout_connect})."
    )
  }
  invisible(con)
}
