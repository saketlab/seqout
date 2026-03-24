#' Find projects by keywords and filters
#'
#' Search and filter projects across all databases without writing SQL.
#' Combines free-text keyword matching with structured filters on organism,
#' assay type, year, country, and more.
#'
#' @param con A `seqout_connection` from [connect_seqout()].
#' @param keywords Optional character. Search terms matched against project
#'   titles and descriptions (case-insensitive). Multiple words are split
#'   and each must appear (AND logic), e.g. `"liver cancer scRNA"` finds
#'   projects containing all three terms.
#' @param organism Optional character. Scientific name (e.g.,
#'   `"Homo sapiens"`, `"Mus musculus"`). Use [sq_list_organisms()] to
#'   discover valid values.
#' @param assay Optional character. Assay type to filter by. Matched against
#'   both broad categories (e.g., `"Transcriptomic"`) and specific assays
#'   (e.g., `"RNA-seq"`, `"ChIP-seq"`). Use [sq_list_assays()] to discover
#'   valid values.
#' @param source Optional character. Database source: `"geo"`, `"sra"`,
#'   `"ena"`, or `"ae"` (ArrayExpress).
#' @param country Optional character. Country name (e.g.,
#'   `"United States"`, `"China"`). Use [sq_list_countries()] to discover
#'   valid values.
#' @param year_from,year_to Optional integer. Filter by publication year range.
#' @param min_samples Optional integer. Minimum number of samples.
#' @param min_citations Optional integer. Minimum citation count.
#' @param sort_by How to sort results: `"relevance"` (default, by citation
#'   count), `"date"` (newest first), `"samples"` (most samples first),
#'   or `"citations"`.
#' @param limit Maximum number of results to return. Default 100.
#'
#' @return A tibble with columns: `accession`, `source`, `title`,
#'   `organism`, `assay`, `country`, `published`, `n_samples`,
#'   `citation_count`.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- connect_seqout()
#'
#' # Find human RNA-seq cancer projects
#' sq_find_projects(con,
#'   keywords = "cancer", organism = "Homo sapiens",
#'   assay = "RNA-seq"
#' )
#'
#' # Recent mouse ChIP-seq with many samples
#' sq_find_projects(con,
#'   organism = "Mus musculus", assay = "ChIP-seq",
#'   year_from = 2022, min_samples = 20, sort_by = "date"
#' )
#'
#' # Highly cited single-cell projects
#' sq_find_projects(con,
#'   keywords = "single cell",
#'   min_citations = 100, sort_by = "citations"
#' )
#' }
sq_find_projects <- function(con, keywords = NULL,
                             organism = NULL,
                             assay = NULL,
                             source = NULL,
                             country = NULL,
                             year_from = NULL,
                             year_to = NULL,
                             min_samples = NULL,
                             min_citations = NULL,
                             sort_by = "relevance",
                             limit = 100) {
  .check_connection(con)
  sort_by <- match.arg(sort_by, c("relevance", "date", "samples", "citations"))
  if (!is.null(source)) source <- match.arg(source, c("geo", "sra", "ena", "ae"))

  clauses <- character()
  params <- list()

  if (!is.null(keywords)) {
    words <- trimws(strsplit(keywords, "\\s+")[[1]])
    words <- words[nzchar(words)]
    for (w in words) {
      pattern <- paste0("%", tolower(w), "%")
      clauses <- c(clauses, "(lower(title) LIKE ? OR lower(description) LIKE ?)")
      params <- c(params, list(pattern, pattern))
    }
  }
  if (!is.null(organism)) {
    clauses <- c(clauses, "lower(dominant_scientific_name) = lower(?)")
    params <- c(params, list(organism))
  }
  if (!is.null(assay)) {
    clauses <- c(
      clauses,
      "(lower(dominant_assay_l1) = lower(?) OR lower(dominant_assay_l2) = lower(?))"
    )
    params <- c(params, list(assay, assay))
  }
  if (!is.null(source)) {
    clauses <- c(clauses, "source = ?")
    params <- c(params, list(source))
  }
  if (!is.null(country)) {
    clauses <- c(clauses, "lower(country) = lower(?)")
    params <- c(params, list(country))
  }
  if (!is.null(year_from)) {
    clauses <- c(clauses, "CAST(first_published AS DATE) >= CAST(? AS DATE)")
    params <- c(params, list(paste0(year_from, "-01-01")))
  }
  if (!is.null(year_to)) {
    clauses <- c(clauses, "CAST(first_published AS DATE) <= CAST(? AS DATE)")
    params <- c(params, list(paste0(year_to, "-12-31")))
  }
  if (!is.null(min_samples)) {
    clauses <- c(clauses, "n_samples >= ?")
    params <- c(params, list(as.integer(min_samples)))
  }
  if (!is.null(min_citations)) {
    clauses <- c(clauses, "citation_count >= ?")
    params <- c(params, list(as.integer(min_citations)))
  }

  where <- if (length(clauses) > 0) {
    paste("WHERE", paste(clauses, collapse = " AND "))
  } else {
    ""
  }

  order <- switch(sort_by,
    relevance  = "ORDER BY citation_count DESC NULLS LAST",
    date       = "ORDER BY first_published DESC NULLS LAST",
    samples    = "ORDER BY n_samples DESC NULLS LAST",
    citations  = "ORDER BY citation_count DESC NULLS LAST"
  )

  sql <- sprintf("
    SELECT
      canonical_accession AS accession,
      source,
      title,
      dominant_scientific_name AS organism,
      dominant_assay_l2 AS assay,
      country,
      CAST(first_published AS DATE) AS published,
      n_samples,
      citation_count
    FROM unified_metadata
    %s
    %s
    LIMIT ?
  ", where, order)
  params <- c(params, list(as.integer(limit)))

  .db_query(con, sql, params = params)
}


#' Get projects by assay type with publication dates
#'
#' Retrieves GEO projects whose assay annotation contains the given term(s),
#' along with their publication dates. Matching is case-insensitive substring
#' search against ontology-annotated assay values (e.g., `"scRNA-seq"` matches
#' `scRNA-Seq`, `"snRNA-seq"` matches `snRNA-Seq`, `"ATAC-seq"` matches
#' `ATAC-Seq`).
#'
#' @param con A `seqout_connection` from [connect_seqout()].
#' @param assay Character vector of assay terms to search for, e.g.
#'   `c("scRNA-seq", "snRNA-seq")`.
#' @param year_from,year_to Optional integer. Restrict to projects published
#'   within this year range.
#'
#' @return A tibble with columns `accession`, `assay_type`, and `published`
#'   (first day of the publication month). One row per unique
#'   project–assay-type combination.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- connect_seqout()
#'
#' projects <- sq_assay_projects(con,
#'   assay = c("scRNA-seq", "snRNA-seq"),
#'   year_from = 2015
#' )
#'
#' library(dplyr)
#' projects |>
#'   mutate(year = as.integer(format(published, "%Y"))) |>
#'   count(assay_type, year)
#' }
sq_assay_projects <- function(con, assay, year_from = NULL, year_to = NULL) {
  .check_connection(con)
  check_required(assay)

  date_clauses <- character()
  date_params <- list()
  if (!is.null(year_from)) {
    date_clauses <- c(date_clauses, "extract(year FROM g.published_at) >= ?")
    date_params <- c(date_params, list(as.integer(year_from)))
  }
  if (!is.null(year_to)) {
    date_clauses <- c(date_clauses, "extract(year FROM g.published_at) <= ?")
    date_params <- c(date_params, list(as.integer(year_to)))
  }
  date_where <- if (length(date_clauses) > 0) {
    paste("AND", paste(date_clauses, collapse = " AND "))
  } else {
    ""
  }

  results <- lapply(assay, function(term) {
    sql <- sprintf("
      SELECT DISTINCT
        e.study_accession AS accession,
        ? AS assay_type,
        CAST(date_trunc('month', g.published_at) AS DATE) AS published
      FROM ontology_samples_v3 e
      JOIN geo_series g ON g.accession = e.study_accession
      WHERE lower(e.assay) LIKE lower(?)
        AND g.published_at IS NOT NULL
        %s
    ", date_where)

    # ? order: assay_type label, LIKE pattern, date params
    params <- c(list(term), list(paste0("%", term, "%")), date_params)
    .db_query(con, sql, params = params)
  })

  results <- Filter(function(x) nrow(x) > 0, results)
  if (length(results) == 0) {
    return(tibble::tibble(
      accession  = character(),
      assay_type = character(),
      published  = as.Date(character())
    ))
  }
  do.call(rbind, results)
}


#' List available assay types
#'
#' Returns assay categories with project counts, useful for discovering
#' valid values for the `assay` argument in [sq_find_projects()].
#'
#' @param con A `seqout_connection`.
#' @param level One of `"broad"` (e.g., Transcriptomic, Genomic Sequencing)
#'   or `"specific"` (e.g., RNA-seq, ChIP-seq). Default `"specific"`.
#' @return A tibble with `assay` and `n_projects` columns, sorted by count.
#' @export
sq_list_assays <- function(con, level = "specific") {
  .check_connection(con)
  level <- match.arg(level, c("broad", "specific"))

  col <- if (level == "broad") "dominant_assay_l1" else "dominant_assay_l2"
  sql <- sprintf("
    SELECT %s AS assay, count(*) AS n_projects
    FROM unified_metadata
    WHERE %s IS NOT NULL
    GROUP BY %s
    ORDER BY n_projects DESC
  ", col, col, col)

  .db_query(con, sql)
}


#' List available countries
#'
#' Returns countries with project counts, useful for discovering valid
#' values for the `country` argument in [sq_find_projects()].
#'
#' @param con A `seqout_connection`.
#' @param limit Maximum number of countries to return. Default 50.
#' @return A tibble with `country` and `n_projects` columns, sorted by count.
#' @export
sq_list_countries <- function(con, limit = 50) {
  .check_connection(con)

  .db_query(con, "
    SELECT country, count(*) AS n_projects
    FROM unified_metadata
    WHERE country IS NOT NULL
    GROUP BY country
    ORDER BY n_projects DESC
    LIMIT ?
  ", params = list(as.integer(limit)))
}


#' List available organisms
#'
#' Returns organisms with total experiment counts, useful for discovering
#' valid values for the `organism` argument in [sq_find_projects()].
#'
#' @param con A `seqout_connection`.
#' @param limit Maximum number of organisms to return. Default 50.
#' @return A tibble with `organism` and `n_projects` columns, sorted by count.
#' @export
sq_list_organisms <- function(con, limit = 50) {
  .check_connection(con)

  .db_query(con, "
    SELECT dominant_scientific_name AS organism, count(*) AS n_projects
    FROM unified_metadata
    WHERE dominant_scientific_name IS NOT NULL
    GROUP BY dominant_scientific_name
    ORDER BY n_projects DESC
    LIMIT ?
  ", params = list(as.integer(limit)))
}
