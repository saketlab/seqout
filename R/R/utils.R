#' Spread the submitter's characteristics into one column each
#'
#' GEO nests them under `channels`, as tag/text pairs, which is unreadable in a
#' tibble and awkward to filter on. The keys are the submitter's own, so they
#' vary by study; one that collides with a record column is made unique rather
#' than dropped.
#' @noRd
.unnest_characteristics <- function(samples) {
  if (!is.data.frame(samples) || nrow(samples) == 0) {
    return(samples)
  }

  chars <- lapply(
    seq_len(nrow(samples)),
    function(i) .characteristics_of(as.list(samples[i, ]))
  )
  keys <- unique(unlist(lapply(chars, names), use.names = FALSE))
  if (length(keys) == 0) {
    return(samples)
  }

  cols <- lapply(keys, function(k) {
    vapply(chars, function(ch) .flatten_value(ch[[k]]), character(1))
  })
  names(cols) <- keys

  out <- samples[
    , setdiff(names(samples), c("channels", "characteristics", "attributes_json")),
    drop = FALSE
  ]
  out <- cbind(out, tibble::as_tibble(cols))
  names(out) <- make.unique(names(out))
  tibble::as_tibble(out)
}


#' Characteristics of one sample row, whichever shape the backend used
#'
#' GEO files them as tag/text pairs under `channels`; the SRA family files them
#' as a named `attributes_json`; ArrayExpress and GEA give flat columns and so
#' arrive here with nothing to do.
#' @noRd
.characteristics_of <- function(row) {
  raw <- row$characteristics %||% row$channels %||% row$attributes_json %||% NULL
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
