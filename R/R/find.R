#' Find projects by keywords and filters
#'
#' Search and filter projects across all databases without writing SQL.
#' Combines free-text keyword matching with structured filters on organism,
#' assay type, year, country, and more.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param keywords Optional character. Search terms matched against project
#'   titles and descriptions (case-insensitive). Multiple words are split
#'   and each must appear (AND logic), e.g. `"liver cancer scRNA"` finds
#'   projects containing all three terms.
#' @param organism Optional character. Scientific name (e.g.,
#'   `"Homo sapiens"`, `"Mus musculus"`). Use [list_organisms()] to
#'   discover valid values.
#' @param assay Optional character. Assay type to filter by. Matched against
#'   both broad categories (e.g., `"Transcriptomic"`) and specific assays
#'   (e.g., `"RNA-seq"`, `"ChIP-seq"`). Use [list_assays()] to discover
#'   valid values.
#' @param source Optional character. Database source: `"geo"`, `"sra"`,
#'   `"ena"`, or `"ae"` (ArrayExpress).
#' @param country Optional character. Country name (e.g.,
#'   `"United States"`, `"China"`). Use [list_countries()] to discover
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
#' con <- seqout_connect()
#'
#' # Find human RNA-seq cancer projects
#' find_projects(con,
#'   keywords = "cancer", organism = "Homo sapiens",
#'   assay = "RNA-seq"
#' )
#'
#' # Recent mouse ChIP-seq with many samples
#' find_projects(con,
#'   organism = "Mus musculus", assay = "ChIP-seq",
#'   year_from = 2022, min_samples = 20, sort_by = "date"
#' )
#'
#' # Highly cited single-cell projects
#' find_projects(con,
#'   keywords = "single cell",
#'   min_citations = 100, sort_by = "citations"
#' )
#' }
find_projects <- function(con, keywords = NULL,
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
#' @param con A `seqout_connection` from [seqout_connect()].
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
#' con <- seqout_connect()
#'
#' projects <- assay_projects(con,
#'   assay = c("scRNA-seq", "snRNA-seq"),
#'   year_from = 2015
#' )
#'
#' library(dplyr)
#' projects |>
#'   mutate(year = as.integer(format(published, "%Y"))) |>
#'   count(assay_type, year)
#' }
assay_projects <- function(con, assay, year_from = NULL, year_to = NULL) {
  .check_connection(con)
  check_required(assay)

  published <- "CAST(u.first_published AS DATE)"

  date_clauses <- character()
  date_params <- list()
  if (!is.null(year_from)) {
    date_clauses <- c(date_clauses, sprintf("extract(year FROM %s) >= ?", published))
    date_params <- c(date_params, list(as.integer(year_from)))
  }
  if (!is.null(year_to)) {
    date_clauses <- c(date_clauses, sprintf("extract(year FROM %s) <= ?", published))
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
        u.canonical_accession AS accession,
        ? AS assay_type,
        CAST(date_trunc('month', %s) AS DATE) AS published
      FROM unified_metadata u
      WHERE u.source = 'geo'
        AND (lower(u.assay_l2_counts) LIKE lower(?)
             OR lower(u.single_cell_modality) LIKE lower(?))
        AND u.first_published IS NOT NULL
        %s
    ", published, date_where)

    pattern <- paste0("%", term, "%")
    params <- c(list(term), list(pattern), list(pattern), date_params)
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

.geo_bam_pattern <- function() paste0("%.bam", intToUtf8(c(92L, 34L)), "%")

#' Search GEO series by free text with BAM availability
#'
#' Searches GEO series title, summary, and overall design for the given query
#' terms (AND logic per word, case-insensitive) using DuckDB without the REST
#' API. Returns one row per matching series with the linked SRA accession and a
#' `has_bam` flag indicating whether the series deposited BAM files as
#' supplementary data.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param query Character. One or more words searched across title, summary,
#'   and overall design (e.g., `"PBMC scRNA-seq"`). All words must appear
#'   somewhere in the record (AND logic).
#' @param year_from,year_to Optional integer. Filter to series published within
#'   this year range.
#' @param limit Maximum number of results. Default 200.
#'
#' @return A tibble with columns:
#' \describe{
#'   \item{accession}{GEO series accession (GSE…).}
#'   \item{title}{Series title.}
#'   \item{published}{Publication date.}
#'   \item{sra_accession}{Linked SRA study accession(s), comma-separated.
#'     `NA` if none.}
#'   \item{has_bam}{`TRUE` if the series uploaded BAM files as GEO
#'     supplementary data.}
#' }
#'
#' @details
#' `has_bam` reflects supplementary files at the **series level** only. A
#' larger set of studies deposit BAM files at the **sample level** (individual
#' GSM records). Use [sample_bam()] to check sample-level BAM availability
#' for a specific series.
#'
#' BAM availability in the linked SRA record cannot be determined from the
#' current database because run-level file formats are not stored. To check
#' whether a given SRP has aligned BAM submissions, use the SRA Run Selector or
#' the SRA toolkit.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#'
#' # Find PBMC scRNA-seq datasets
#' results <- geo_search(con, "PBMC scRNA-seq")
#'
#' # Subset to those with BAM files
#' library(dplyr)
#' results |> filter(has_bam)
#'
#' # Also filter to those with a linked SRA accession
#' results |> filter(!is.na(sra_accession))
#' }
geo_search <- function(con, query, year_from = NULL, year_to = NULL,
                       limit = 200) {
  .check_connection(con)
  check_required(query)

  bam_pat <- .geo_bam_pattern()

  words <- trimws(strsplit(query, "\\s+")[[1]])
  words <- words[nzchar(words)]

  word_clauses <- character()
  word_params <- list()
  for (w in words) {
    p <- paste0("%", w, "%")
    word_clauses <- c(
      word_clauses,
      "(lower(g.title) LIKE lower(?) OR lower(g.summary) LIKE lower(?) OR lower(g.overall_design) LIKE lower(?))"
    )
    word_params <- c(word_params, list(p, p, p))
  }

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

  all_clauses <- c(word_clauses, date_clauses)
  where <- if (length(all_clauses) > 0) {
    paste("WHERE", paste(all_clauses, collapse = " AND "))
  } else {
    ""
  }

  sql <- sprintf("
    WITH matches AS (
      SELECT
        g.accession,
        g.title,
        g.published_at,
        COALESCE(g.supplementary_data LIKE ?, FALSE) AS has_bam
      FROM geo_series g
      %s
      ORDER BY g.published_at DESC NULLS LAST
      LIMIT ?
    )
    SELECT
      m.accession,
      m.title,
      CAST(m.published_at AS DATE) AS published,
      m.has_bam,
      json_extract_string(um.aliases, '$.sra') AS sra_accession
    FROM matches m
    LEFT JOIN unified_metadata um ON um.canonical_accession = m.accession
    ORDER BY m.published_at DESC NULLS LAST
  ", where)

  params <- c(list(bam_pat), word_params, date_params, list(as.integer(limit)))
  .db_query(con, sql, params = params)
}

#' Check sample-level BAM availability for a GEO series
#'
#' Returns the GEO samples within a series that have BAM files deposited as
#' supplementary data, along with the BAM file URLs.
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param accession Character. GEO series accession (e.g., `"GSE151530"`).
#'
#' @return A tibble with columns `sample_accession` and `bam_urls` (a
#'   character vector of matching FTP URLs per sample).
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' sample_bam(con, "GSE151530")
#' }
sample_bam <- function(con, accession) {
  .check_connection(con)
  check_required(accession)

  bam_pat <- .geo_bam_pattern()

  sql <- "
    SELECT
      gsm.accession AS sample_accession,
      regexp_extract_all(
        gsm.supplementary_data,
        'ftp://[^\"]+'
      ) AS bam_urls
    FROM geo_series gser
    CROSS JOIN UNNEST(gser.samples_ref) AS t(gsm_acc)
    JOIN geo_samples gsm ON gsm.accession = t.gsm_acc
    WHERE gser.accession = ?
      AND gsm.supplementary_data LIKE ?
  "
  .db_query(con, sql, params = list(accession, bam_pat))
}

#' Check BAM file availability in SRA for a set of study accessions
#'
#' Queries the `run_download_links` table via DuckDB to check whether any
#' run in each study was submitted in BAM format (detected from the original
#' NCBI file listing).
#'
#' @param con A `seqout_connection` from [seqout_connect()].
#' @param sra_accessions Character vector of SRA study accessions (e.g.
#'   the `sra_accession` column from [geo_search()]).
#'
#' @return A tibble with columns `sra_accession` and `has_bam_sra` (logical).
#'   Studies with no runs in the database are returned with
#'   `has_bam_sra = FALSE`.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#'
#' results <- geo_search(con, "PBMC scRNA-seq")
#'
#' library(dplyr)
#' srps <- results |>
#'   filter(!is.na(sra_accession)) |>
#'   pull(sra_accession)
#' bam_status <- check_sra_bam(con, srps[1:10])
#'
#' results |>
#'   left_join(bam_status, by = "sra_accession") |>
#'   filter(has_bam_sra)
#' }
check_sra_bam <- function(con, sra_accessions) {
  .check_connection(con)
  check_required(sra_accessions)

  sra_accessions <- unique(sra_accessions[!is.na(sra_accessions)])

  placeholders <- paste(rep("?", length(sra_accessions)), collapse = ", ")
  sql <- sprintf("
    SELECT study_accession AS sra_accession,
      bool_or(ncbi_files LIKE '%%.bam\"%%') AS has_bam_sra
    FROM run_download_links
    WHERE study_accession IN (%s)
    GROUP BY study_accession
  ", placeholders)

  result <- .db_query(con, sql, params = as.list(sra_accessions))

  tibble::tibble(sra_accession = sra_accessions) |>
    dplyr::left_join(result, by = "sra_accession") |>
    dplyr::mutate(has_bam_sra = dplyr::coalesce(has_bam_sra, FALSE))
}

#' List available assay types
#'
#' Returns assay categories with project counts, useful for discovering
#' valid values for the `assay` argument in [find_projects()].
#'
#' @param con A `seqout_connection`.
#' @param level One of `"broad"` (e.g., Transcriptomic, Genomic Sequencing)
#'   or `"specific"` (e.g., RNA-seq, ChIP-seq). Default `"specific"`.
#' @return A tibble with `assay` and `n_projects` columns, sorted by count.
#' @export
list_assays <- function(con, level = "specific") {
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
#' values for the `country` argument in [find_projects()].
#'
#' @param con A `seqout_connection`.
#' @param limit Maximum number of countries to return. Default 50.
#' @return A tibble with `country` and `n_projects` columns, sorted by count.
#' @export
list_countries <- function(con, limit = 50) {
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
#' valid values for the `organism` argument in [find_projects()].
#'
#' @param con A `seqout_connection`.
#' @param limit Maximum number of organisms to return. Default 50.
#' @return A tibble with `organism` and `n_projects` columns, sorted by count.
#' @export
list_organisms <- function(con, limit = 50) {
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
