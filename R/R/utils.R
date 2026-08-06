#' Sample characteristics as a table
#'
#' Flattens the free-text key/value pairs a submitter recorded for each sample
#' into one row per sample, indexed by accession. The keys are chosen by the
#' submitter, so the columns vary by study and are worth inspecting before being
#' relied on.
#'
#' @param samples A tibble of samples, from [project_samples()].
#'
#' @return A tibble with one row per sample and a column per characteristic.
#'
#' @export
#' @examples
#' \dontrun{
#' con <- seqout_connect()
#' sample_frame(project_samples(con, "GSE114725"))
#' }
sample_frame <- function(samples) {
  rlang::check_required(samples)
  if (!is.data.frame(samples) || nrow(samples) == 0) {
    return(tibble::tibble())
  }

  rows <- lapply(seq_len(nrow(samples)), function(i) {
    row <- as.list(samples[i, ])
    base <- list(
      sample = row$accession %||% NA_character_,
      title = row$title %||% NA_character_
    )
    c(base, .characteristics_of(row))
  })

  .records_to_tibble(rows)
}


#' Characteristics of one sample row, whichever shape the backend used
#'
#' The API flattens them to a named list; Parquet keeps GEO's raw list of
#' tag/text pairs; an ArrayExpress sample carries flat attributes instead.
#' @noRd
.characteristics_of <- function(row) {
  raw <- row$characteristics %||% row$channels %||% NULL
  if (is.null(raw)) {
    return(list())
  }
  while (is.list(raw) && length(raw) == 1 && is.null(names(raw)) && is.list(raw[[1]])) {
    raw <- raw[[1]]
  }
  if (is.list(raw) && !is.null(raw$Characteristics)) {
    raw <- raw$Characteristics
  }
  if (!is.null(names(raw)) && !any(c("@tag", "#text") %in% names(raw))) {
    return(as.list(raw))
  }
  out <- list()
  for (item in raw) {
    if (is.list(item) && !is.null(item[["@tag"]])) {
      out[[as.character(item[["@tag"]])]] <- as.character(item[["#text"]] %||% NA_character_)
    }
  }
  out
}
