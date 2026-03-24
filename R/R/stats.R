#' Get database growth statistics
#'
#' Returns monthly project or experiment counts per database. Uses DuckDB
#' for `"projects"` and `"experiments"` modes. Falls back to the REST API
#' for `"bases"` mode (byte-level data is not in the Parquet tables).
#'
#' @param con A `seqout_connection`.
#' @param mode One of `"projects"`, `"experiments"`, or `"bases"`.
#' @param db Optional. Restrict to a specific database.
#' @return A tibble with growth data (columns depend on mode).
#' @export
sq_growth_stats <- function(con, mode = "projects", db = NULL) {
  .check_connection(con)
  mode <- match.arg(mode, c("projects", "experiments", "bases"))

  # DuckDB path for projects and experiments
  if (mode %in% c("projects", "experiments")) {
    if (mode == "projects") {
      if (!is.null(db)) {
        db <- match.arg(db, .valid_dbs)
        sql <- "
          SELECT source AS db,
                 CAST(first_published AS DATE) AS month,
                 count(*) AS count
          FROM unified_metadata
          WHERE first_published IS NOT NULL AND source = ?
          GROUP BY source, month
          ORDER BY source, month
        "
        return(.db_query(con, sql, params = list(db)))
      }
      sql <- "
        SELECT source AS db,
               CAST(first_published AS DATE) AS month,
               count(*) AS count
        FROM unified_metadata
        WHERE first_published IS NOT NULL
        GROUP BY source, month
        ORDER BY source, month
      "
      return(.db_query(con, sql))
    }

    # experiments mode
    if (!is.null(db)) {
      db <- match.arg(db, .valid_dbs)
      sql <- "
        SELECT db, CAST(month AS DATE) AS month, sum(count) AS count
        FROM organism_growth_monthly
        WHERE db = ?
        GROUP BY db, month
        ORDER BY month
      "
      return(.db_query(con, sql, params = list(db)))
    }

    sql <- "
      SELECT db, CAST(month AS DATE) AS month, sum(count) AS count
      FROM organism_growth_monthly
      GROUP BY db, month
      ORDER BY db, month
    "
    return(.db_query(con, sql))
  }

  # bases mode — REST API only
  if (!is.null(db)) db <- match.arg(db, c(.valid_dbs, "sra_fastq_bytes", "sra_sra_bytes"))
  params <- .compact(list(mode = mode, db = db))
  result <- do.call(.api_get, c(list(con = con, path = "/stats/growth"), params))
  .records_to_tibble(result)
}


#' Get global geographic contributions
#'
#' @param con A `seqout_connection`.
#' @param organism Optional. Filter by scientific name.
#' @param assay_l1 Optional. Filter by assay level 1.
#' @param assay_l2 Optional. Filter by assay level 2.
#' @param place_type Optional. Filter by place type.
#' @param address_type Optional. Filter by address type.
#' @return A tibble with geographic contribution data.
#' @export
sq_global_contributions <- function(con, organism = NULL, assay_l1 = NULL,
                                    assay_l2 = NULL, place_type = NULL,
                                    address_type = NULL) {
  .check_connection(con)

  # DuckDB path — build WHERE clause from filters
  clauses <- "country IS NOT NULL"
  params <- list()
  if (!is.null(organism)) {
    clauses <- paste(clauses, "AND dominant_scientific_name = ?")
    params <- c(params, list(organism))
  }
  if (!is.null(assay_l1)) {
    clauses <- paste(clauses, "AND dominant_assay_l1 = ?")
    params <- c(params, list(assay_l1))
  }
  if (!is.null(assay_l2)) {
    clauses <- paste(clauses, "AND dominant_assay_l2 = ?")
    params <- c(params, list(assay_l2))
  }
  if (!is.null(place_type)) {
    clauses <- paste(clauses, "AND place_type = ?")
    params <- c(params, list(place_type))
  }
  if (!is.null(address_type)) {
    clauses <- paste(clauses, "AND address_type = ?")
    params <- c(params, list(address_type))
  }

  sql <- sprintf("
    SELECT country, count(*) AS n_projects,
           sum(n_experiments) AS n_experiments,
           sum(n_samples) AS n_samples
    FROM unified_metadata
    WHERE %s
    GROUP BY country
    ORDER BY n_projects DESC
  ", clauses)

  .db_query(con, sql, params = if (length(params) > 0) params else NULL)
}


#' Get filter options for global contributions
#'
#' @param con A `seqout_connection`.
#' @param country Optional. Scope filters to a country.
#' @param organism Optional. Scope assay counts (requires `country`).
#' @return A list of available filter values.
#' @export
sq_global_contribution_filters <- function(con, country = NULL,
                                           organism = NULL) {
  .check_connection(con)

  where <- "WHERE country IS NOT NULL"
  params <- list()
  if (!is.null(country)) {
    where <- paste(where, "AND country = ?")
    params <- c(params, list(country))
  }
  if (!is.null(organism)) {
    where <- paste(where, "AND dominant_scientific_name = ?")
    params <- c(params, list(organism))
  }

  sql <- sprintf("
    SELECT
      list(DISTINCT country ORDER BY country) AS countries,
      list(DISTINCT dominant_scientific_name ORDER BY dominant_scientific_name)
        FILTER (WHERE dominant_scientific_name IS NOT NULL) AS organisms,
      list(DISTINCT dominant_assay_l1 ORDER BY dominant_assay_l1)
        FILTER (WHERE dominant_assay_l1 IS NOT NULL) AS assay_l1,
      list(DISTINCT dominant_assay_l2 ORDER BY dominant_assay_l2)
        FILTER (WHERE dominant_assay_l2 IS NOT NULL) AS assay_l2,
      list(DISTINCT place_type ORDER BY place_type)
        FILTER (WHERE place_type IS NOT NULL) AS place_types,
      list(DISTINCT address_type ORDER BY address_type)
        FILTER (WHERE address_type IS NOT NULL) AS address_types
    FROM unified_metadata
    %s
  ", where)

  row <- .db_query(con, sql, params = if (length(params) > 0) params else NULL)
  as.list(row)
}
