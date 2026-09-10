#' Validate a local dump path
#'
#' A missing directory gives noisy table errors. URLs pass through to DuckDB.
#' @noRd
.check_data_dir <- function(data_dir, backend) {
  if (is.null(data_dir)) {
    return(NULL)
  }
  if (!is.character(data_dir) || length(data_dir) != 1 || is.na(data_dir)) {
    cli::cli_abort("{.arg data_dir} must be one directory or URL.")
  }
  if (identical(backend, "api")) {
    cli::cli_warn(c(
      "{.arg data_dir} does nothing on the {.val api} backend.",
      "i" = "Use {.code SeqoutConnect(\"parquet\", data_dir = ...)} to read it."
    ))
    return(NULL)
  }
  data_dir <- sub("/$", "", path.expand(data_dir))
  remote <- grepl("^[a-z][a-z0-9+.-]*://", data_dir, ignore.case = TRUE)
  if (!remote && !dir.exists(data_dir)) {
    cli::cli_abort(c(
      "{.arg data_dir} is not a directory: {.path {data_dir}}.",
      "i" = "It should hold the {.file .parquet} files themselves,
             {.file geo_series.parquet} and its siblings."
    ))
  }
  data_dir
}

#' Connect to Seqout
#'
#' Two backends are supported:
#'
#' * `"api"`, the default, reads <https://seqout.org> with HTTP.
#' * `"parquet"` reads the Parquet dump with DuckDB through `httpfs`. It
#'   answers SQL and can read a local dump. Requires the `duckdb` package.
#'
#' Select Parquet explicitly; one lookup can become a dump scan.
#'
#' @param backend `"api"`, the default, or `"parquet"`. See the description.
#' @param base_url Seqout server URL. Defaults to `SEQOUT_BASE_URL`, then
#'   `"https://seqout.org"`.
#' @param data_dir Directory or URL holding the `.parquet` files. `NULL` reads
#'   `"<base_url>/data"`. The `"api"` backend ignores it.
#' @param read_only Make the DuckDB connection read-only. The default is
#'   `FALSE`, so that [cache_table()] can write views to local storage. The
#'   `"api"` backend ignores this argument.
#' @param eager Register every Parquet view at connection time. The `"api"`
#'   backend ignores it.
#' @param quiet Do not show the message at the start.
#'
#' @return A `seqout_connection` object.
#'
#' @export
#' @examples
#' \dontrun{
#' # REST API default
#' project("GSE297547")
#'
#' # Parquet for SQL and local dumps
#' con <- SeqoutConnect("parquet")
#' Query("SELECT * FROM geo_series LIMIT 5", con = con)
#' SeqoutClose(con)
#'
#' # local dump
#' con <- SeqoutConnect("parquet", data_dir = "~/seqout-dump")
#' Query("SELECT count(*) FROM geo_series", con = con)
#' SeqoutClose(con)
#' }
seqout_connect <- function(backend = c("api", "parquet"),
                           base_url = Sys.getenv("SEQOUT_BASE_URL", "https://seqout.org"),
                           data_dir = NULL,
                           read_only = FALSE,
                           eager = FALSE,
                           quiet = FALSE) {
  backend <- match.arg(backend)
  base_url <- sub("/$", "", base_url)
  data_dir <- .check_data_dir(data_dir, backend)

  con <- new.env(parent = emptyenv())
  con$backend <- backend
  con$base_url <- base_url
  con$data_url <- data_dir %||% paste0(base_url, "/data")
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
      cli::cli_alert_success("Seqout ({.url {base_url}}) \u2014 REST backend")
    } else {
      cli::cli_alert_success(
        "Seqout ({.url {base_url}}) \u2014 Parquet backend, {length(con$tables)} table{?s}"
      )
    }
  }

  con
}

#' Process-wide default connection state
#' @noRd
.seqout_state <- new.env(parent = emptyenv())

#' Set the process-wide default connection
#'
#' @param con A `seqout_connection`, or `NULL` to go back to the built-in
#'   REST default.
#'
#' @return The previous default, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' SeqoutDefault(SeqoutConnect("parquet"))
#' project("GSE297547") # now reads Parquet
#' SeqoutDefault(NULL) # back to REST
#' }
seqout_default <- function(con) {
  if (!is.null(con)) .check_connection(con)
  old <- .seqout_state$default
  .seqout_state$default <- con
  invisible(old)
}

#' Resolve the connection for a call
#'
#' The default connection is built lazily, so package load opens nothing.
#' @noRd
.con <- function() {
  if (is.null(.seqout_state$default)) {
    .seqout_state$default <- seqout_connect("api", quiet = TRUE)
  }
  .seqout_state$default
}

#' Require a Parquet connection
#'
#' Abort before a REST call triggers a dump scan.
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

#' Require a REST connection
#'
#' Some API data is absent from the dump.
#' @param why An extra hint naming what the dump is missing.
#' @noRd
.need_api <- function(con, what, why = NULL) {
  .check_connection(con)
  if (identical(con$backend, "api")) {
    return(invisible(con))
  }
  cli::cli_abort(c(
    "{.fn {what}} reads the REST API; this connection is Parquet.",
    i = why,
    i = "Drop {.arg con} to use the shared REST connection."
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
    "to query the Seqout Parquet tables (REST-only functions do not need it)."
  )
  rlang::check_installed(
    "DBI",
    "to query the Seqout Parquet tables (REST-only functions do not need it)."
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
  try(DBI::dbExecute(db, "SET http_keep_alive = false"), silent = TRUE)
  # Appended to DuckDB's User-Agent so seqout.org can attribute parquet reads.
  try(DBI::dbExecute(db, sprintf("SET custom_user_agent = '%s'", .user_agent())), silent = TRUE)

  con$state$drv <- drv
  con$state$db <- db
  db
}

#' Register the remote Parquet views
#'
#' Views are lazy; catalog reads need them registered first.
#'
#' @param con A Parquet `seqout_connection` from [seqout_connect()].
#' @param tables Which tables to register. Defaults to all of them.
#' @param progress Show a progress bar. Defaults to `TRUE` interactively.
#'
#' @return The names of every registered view, invisibly.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- SeqoutConnect("parquet")
#' RegisterTables(con, "unified_metadata")
#' dplyr::tbl(con$db, "unified_metadata")
#'
#' # all views
#' SeqoutConnect("parquet") |> RegisterTables()
#' }
register_tables <- function(con = .con(), tables = NULL,
                            progress = interactive()) {
  .need_parquet(con, "register_tables")
  tables <- tables %||% con$tables
  unknown <- setdiff(tables, con$tables)
  if (length(unknown) > 0) {
    cli::cli_abort("Not a Seqout table: {.val {unknown}}.")
  }
  invisible(.register_views(con, tables, progress = progress))
}

#' Register missing views
#'
#' `con$views` is shared, so copied connections see the same views.
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

#' Close a Seqout connection
#'
#' Parquet closes its DuckDB handle; REST has no handle.
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
  cli::cli_alert_info("Seqout connection closed.")
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

#' Keep in sync with EXPORT_TABLES and Python _ALL_PARQUET_FILES.
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
