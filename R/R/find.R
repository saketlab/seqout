#' Get projects by assay type with publication dates
#'
#' Retrieves GEO projects whose assay annotation contains the given term(s),
#' along with their publication dates. Matching is case-insensitive substring
#' search against ontology-annotated assay values (e.g., `"scRNA-seq"` matches
#' `scRNA-Seq`, `"snRNA-seq"` matches `snRNA-Seq`, `"ATAC-seq"` matches
#' `ATAC-Seq`).
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
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
#' con <- seqout_connect("parquet")
#'
#' projects <- assay_projects(
#'   assay = c("scRNA-seq", "snRNA-seq"),
#'   year_from = 2015
#' )
#'
#' library(dplyr)
#' projects |>
#'   mutate(year = as.integer(format(published, "%Y"))) |>
#'   count(assay_type, year)
#' }
assay_projects <- function(assay, year_from = NULL, year_to = NULL, con = .con()) {
  .need_parquet(con, "assay_projects")
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

#' Check sample-level BAM availability for a GEO series
#'
#' Returns the GEO samples within a series that have BAM files deposited as
#' supplementary data, along with the BAM file URLs.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param accession Character. GEO series accession (e.g., `"GSE151530"`).
#'
#' @return A tibble with columns `sample_accession` and `bam_urls` (a
#'   character vector of matching FTP URLs per sample).
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect("parquet")
#' sample_bam("GSE151530")
#' }
sample_bam <- function(accession, con = .con()) {
  .need_parquet(con, "sample_bam")
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
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param sra_accessions Character vector of SRA study accessions (e.g.
#'   the `sra_accession` column from [search()]).
#'
#' @return A tibble with columns `sra_accession` and `has_bam_sra` (logical).
#'   Studies with no runs in the database are returned with
#'   `has_bam_sra = FALSE`.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect("parquet")
#'
#' results <- search("PBMC scRNA-seq", source = "geo", con = con)
#'
#' library(dplyr)
#' srps <- results |>
#'   filter(!is.na(sra_accession)) |>
#'   pull(sra_accession)
#' bam_status <- check_sra_bam(srps[1:10])
#'
#' results |>
#'   left_join(bam_status, by = "sra_accession") |>
#'   filter(has_bam_sra)
#' }
check_sra_bam <- function(sra_accessions, con = .con()) {
  .need_parquet(con, "check_sra_bam")
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

  found <- result$has_bam_sra[match(sra_accessions, result$sra_accession)]
  tibble::tibble(
    sra_accession = sra_accessions,
    has_bam_sra = !is.na(found) & found
  )
}

#' List available assay types
#'
#' Returns assay categories with project counts, useful for discovering
#' valid values for the `assay` argument of [search()].
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param level One of `"broad"` (e.g., Transcriptomic, Genomic Sequencing)
#'   or `"specific"` (e.g., RNA-seq, ChIP-seq). Default `"specific"`.
#' @return A tibble with `assay` and `n_projects` columns, sorted by count.
#' @export
list_assays <- function(level = "specific", con = .con()) {
  .need_parquet(con, "list_assays")
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
#' values for the `country` argument of [search()].
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param limit Maximum number of countries to return. Default 50.
#' @return A tibble with `country` and `n_projects` columns, sorted by count.
#' @export
list_countries <- function(limit = 50, con = .con()) {
  .need_parquet(con, "list_countries")

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
#' valid values for the `organism` argument of [search()].
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param limit Maximum number of organisms to return. Default 50.
#' @return A tibble with `organism` and `n_projects` columns, sorted by count.
#' @export
list_organisms <- function(limit = 50, con = .con()) {
  .need_parquet(con, "list_organisms")

  .db_query(con, "
    SELECT dominant_scientific_name AS organism, count(*) AS n_projects
    FROM unified_metadata
    WHERE dominant_scientific_name IS NOT NULL
    GROUP BY dominant_scientific_name
    ORDER BY n_projects DESC
    LIMIT ?
  ", params = list(as.integer(limit)))
}
