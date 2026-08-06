#' Data model and grouping rules behind seqout_counts()
#'
#' A unit is the group of supplementary files that read as one matrix. `.group_units()` turns a flat file list into
#' units, which is where 10x triplet assembly and the filtered-over-raw
#' preference live.
#' @noRd
NULL

#' @noRd
.series_key <- "\r__series__"

#' @noRd
.triplet_roles <- c("mtx", "barcodes", "features")

#' @noRd
.role_fmt <- c(h5 = "10x_h5", h5ad = "h5ad", rds = "rds", tar = "tar", table = "table")

#' @noRd
.fmt_rank <- c("10x_mtx" = 0L, "10x_h5" = 1L, h5ad = 2L, rds = 3L, tar = 4L, table = 5L)

#' @noRd
.bulk_max_obs <- 32L
#' @noRd
.sc_min_obs <- 400L

#' Group supplementary files into readable units
#'
#' 10x triplets group on a shared key (a CellRanger directory, else the filename
#' with its role token stripped); everything else is its own unit. Within a
#' sample, filtered output wins over raw, and a complete triplet or 10x h5 wins
#' over a loose table.
#'
#' @param files A tibble of files with `url`, `role`, `sample`, `platform`,
#'   `member` and `name` columns.
#' @param accession The series or sample accession the files belong to.
#' @param assay Which assay to prefer when a sample carries several.
#'
#' @return A list of unit lists.
#' @noRd
.group_units <- function(files, accession, assay = "rna") {
  n <- nrow(files)
  rows <- .mapply(function(...) list(...), as.list(files), NULL)
  key_samples <- files$sample
  key_samples[is.na(key_samples)] <- .series_key

  is_metadata <- files$role == "metadata"
  metadata_idx <- which(is_metadata)
  metadata <- lapply(
    split(metadata_idx, factor(key_samples[metadata_idx], levels = unique(key_samples[metadata_idx]))),
    function(idx) rows[idx]
  )

  is_triplet <- files$role %in% .triplet_roles
  triplet_idx <- which(is_triplet)
  if (length(triplet_idx) > 0) {
    triplet_keys <- paste0(key_samples[triplet_idx], "\r", group_key(files$name[triplet_idx]))
    triplets <- lapply(
      split(triplet_idx, factor(triplet_keys, levels = unique(triplet_keys))),
      function(idx) rows[idx]
    )
  } else {
    triplets <- list()
  }

  unit_idx <- which(!is_metadata & !is_triplet)
  units <- lapply(unit_idx, function(i) {
    f <- rows[[i]]
    list(
      label = if (!is.na(f$sample)) f$sample else f$name,
      fmt = unname(.role_fmt[[f$role]]),
      files = list(f),
      sample = f$sample,
      platform = f$platform
    )
  })

  leftovers <- list()
  triplet_units <- list()
  for (key in names(triplets)) {
    members <- triplets[[key]]
    roles <- vapply(members, function(m) m$role, character(1))
    sample <- members[[1]]$sample
    if (!all(.triplet_roles %in% roles)) {
      ks <- if (is.na(sample)) .series_key else sample
      leftovers[[ks]] <- c(leftovers[[ks]], members)
      next
    }
    triplet_units[[length(triplet_units) + 1]] <- list(
      label = if (!is.na(sample)) sample else accession,
      fmt = "10x_mtx",
      files = members,
      sample = sample,
      platform = members[[1]]$platform
    )
  }

  units <- c(units, triplet_units, .pair_leftovers(leftovers, accession))
  units <- .attach_metadata(units, metadata)
  .prefer_units(units, assay)
}

#' Rescue a triplet whose files share no filename prefix
#'
#' Plenty of submitters ship GSE1_barcodes.tsv.gz and GSE1_features.tsv.gz
#' alongside GSE1_someassay_dge.mtx.gz, so the name-derived key splits them three
#' ways. When exactly one file of each role is left over within a sample scope
#' there is only one pairing possible, so take it; ambiguity still declines.
#' @noRd
.pair_leftovers <- function(leftovers, accession) {
  out <- list()
  for (ks in names(leftovers)) {
    members <- leftovers[[ks]]
    roles <- vapply(members, function(m) m$role, character(1))
    role_index <- match(roles, .triplet_roles)
    counts <- tabulate(role_index, nbins = length(.triplet_roles))
    if (!all(counts == 1L)) {
      next
    }
    ordered <- members[match(.triplet_roles, roles)]
    sample <- ordered[[1]]$sample
    out[[length(out) + 1]] <- list(
      label = if (!is.na(sample)) sample else accession,
      fmt = "10x_mtx",
      files = ordered,
      sample = sample,
      platform = ordered[[1]]$platform
    )
  }
  out
}

#' Give each unit the annotation files that describe it
#'
#' A file named for a sample goes to that sample's units; series-level
#' annotation describes the whole study, so it goes to every unit.
#' @noRd
.attach_metadata <- function(units, metadata) {
  shared <- metadata[[.series_key]]
  lapply(units, function(u) {
    own <- if (!is.na(u$sample)) metadata[[u$sample]] else NULL
    u$metadata_files <- c(own, shared)
    u
  })
}

#' Mark one unit per sample as preferred
#'
#' Filtered beats raw, then the most structured format wins. The rest stay in
#' the list; a sample that ships both a 10x h5 and its mtx triplet should still
#' let you ask for the triplet.
#' @noRd
.prefer_units <- function(units, assay) {
  if (length(units) == 0) {
    return(units)
  }
  keys <- vapply(units, function(u) if (is.na(u$sample)) "" else u$sample, character(1))
  has_per_sample <- any(nzchar(keys))
  groups <- split(seq_along(units), factor(keys, levels = unique(keys)))

  keyed <- nzchar(names(groups))
  for (g in which(keyed & lengths(groups) > 1)) {
    idx <- groups[[g]]
    units[idx] <- .label_distinctly(names(groups)[g], units[idx])
  }

  ranks <- .unit_ranks(units, assay)
  for (g in seq_along(groups)) {
    idx <- groups[[g]]
    best <- idx[which.min(ranks[idx])]
    preferred <- idx == best & !(!keyed[g] & has_per_sample)
    for (j in seq_along(idx)) {
      units[[idx[j]]]$preferred <- preferred[j]
    }
  }
  order_key <- order(!nzchar(keys), vapply(units, function(u) u$label, character(1)))
  units[order_key]
}

#' Give each of a sample's units a label that identifies it uniquely
#'
#' The format alone is not enough: a CITE-seq sample ships its RNA and antibody
#' matrices in the same format, and duplicate labels would make selection by
#' label return whichever came first.
#' @noRd
.label_distinctly <- function(sample, members) {
  members <- lapply(members, function(u) {
    u$label <- paste0(sample, ":", u$fmt)
    u
  })
  labels <- vapply(members, function(u) u$label, character(1))
  if (length(unique(labels)) == length(members)) {
    return(members)
  }
  lapply(members, function(u) {
    stem <- sub("\\..*$", "", basename(u$files[[1]]$name))
    stem <- sub(paste0("^", sample), "", stem)
    stem <- gsub("^[._-]+|[._-]+$", "", stem)
    u$label <- paste0(sample, ":", if (nzchar(stem)) stem else u$fmt)
    u
  })
}

#' Rank every unit in one pass
#'
#' `filtered` is decided per file, not on the joined text: a unit holding both
#' a raw and an unfiltered name would otherwise read as unfiltered.
#' @noRd
.unit_ranks <- function(units, assay) {
  names_by_unit <- lapply(units, function(u) {
    vapply(u$files, function(f) f$name, character(1))
  })
  any_filtered <- vapply(names_by_unit, function(n) any(is_filtered(n)), logical(1))

  modality <- .modality_rank(
    vapply(names_by_unit, paste, character(1), collapse = " "), assay
  )
  fmts <- vapply(units, function(u) u$fmt, character(1))
  modality * 100 + (!any_filtered) * 10 + unname(.fmt_rank[fmts])
}

#' Whether per-cell annotation is available for a unit
#' @noRd
.unit_has_metadata <- function(u) {
  length(u$metadata_files) > 0 || u$fmt %in% .embedded_metadata_formats
}

#' Bulk or single-cell, decided on evidence
#'
#' Shape is only decisive at the extremes; a 384-column Smart-seq plate sits in
#' the middle and stays unknown.
#'
#' @param obs_names Row labels of the observation table.
#' @param n_series_samples Samples in the series, an input to the decision.
#'
#' @return A list with `kind` and `evidence`.
#' @noRd
.infer_kind <- function(obs_names, n_series_samples = 0L) {
  n <- length(obs_names)
  head_names <- utils::head(as.character(obs_names), 200)
  ev <- character(0)

  if (length(head_names) > 0) {
    barcode <- grepl("^[ACGTN]{12,}(-[0-9]+)?$", head_names)
    if (sum(barcode) > length(head_names) * 0.5) {
      return(list(kind = "single_cell", evidence = "row labels look like cell barcodes"))
    }
    gsm <- grepl("^GSM[0-9]+", head_names)
    if (sum(gsm) > length(head_names) * 0.5) {
      return(list(kind = "bulk", evidence = "row labels are GSM accessions"))
    }
  }

  ev <- c(ev, sprintf("%d observations", n))
  if (n_series_samples > 0 && n <= n_series_samples) {
    ev <- c(ev, sprintf("no more observations than the %d samples in the series", n_series_samples))
    return(list(kind = "bulk", evidence = ev))
  }
  if (n <= .bulk_max_obs) {
    return(list(kind = "bulk", evidence = ev))
  }
  if (n >= .sc_min_obs) {
    return(list(kind = "single_cell", evidence = ev))
  }
  ev <- c(ev, sprintf(
    "between %d and %d, could be a Smart-seq plate", .bulk_max_obs, .sc_min_obs
  ))
  list(kind = "unknown", evidence = ev)
}
