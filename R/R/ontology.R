#' One term, its synonyms and its children, as a tibble
#'
#' Rows are the term itself, then its synonyms, then its children. `xrefs` is a
#' list column because a term can carry an identifier from several ontologies.
#' @noRd
.onto_tibble <- function(rows) {
  tibble::tibble(
    relation = vapply(rows, function(r) r$relation, character(1)),
    name = vapply(rows, function(r) .pnt_chr(r$name), character(1)),
    xrefs = lapply(rows, function(r) as.character(unlist(r$xrefs, use.names = FALSE))),
    has_children = vapply(rows, function(r) .pnt_lgl(r$has_children), logical(1))
  )
}

#' A term row, in the shape `.onto_tibble()` reads.
#' @noRd
.onto_row <- function(record, relation) {
  list(
    relation = relation,
    name = record$name,
    xrefs = record$xrefs,
    has_children = record$has_children %||% FALSE
  )
}


#' What the ontology graph knows about a term
#'
#' A plain keyword search does not match words, it matches concepts: a query
#' for `"masld"` also finds studies that say `"nonalcoholic fatty liver
#' disease"`, because an ontology graph joins the two. This function looks one
#' term up in that graph.
#'
#' The result gives the source identifiers behind the term (UBERON, MeSH, HGNC,
#' Cellosaurus), the synonyms a search expands it to, and the terms below it in
#' the hierarchy. Each row carries its own identifiers.
#'
#' `max_hops` bounds the walk over the synonym links only. Children are always
#' the direct children of the resulting synonym cluster, at any `max_hops`.
#'
#' A term the graph does not have returns an empty tibble, not an error, so a
#' loop over many words does not stop at the first one it misses.
#'
#' Reads the REST API. The ontology graph is a separate database and is not in
#' the dump.
#'
#' @param con A `seqout_connection`. Defaults to the shared REST connection.
#' @param term The word or phrase to look up. Case does not matter.
#' @param max_hops How far to walk the synonym links, 1 to 4.
#' @param children Set `FALSE` to skip the children, which is much cheaper.
#'
#' @return A tibble with one row for the term, one for each synonym and one for
#'   each child. Columns: `relation`, `name`, `xrefs` (a list column of source
#'   CURIEs) and `has_children`. The `synonym_total`, `children_truncated` and
#'   `max_hops` attributes report what the server capped.
#'
#' @seealso [seqout_search()], which expands a plain query through this graph.
#'
#' @export
#' @examples
#' \dontrun{
#' Ontology("liver")
#'
#' # The identifiers alone, without the hierarchy query
#' Ontology("breast cancer", children = FALSE)$xrefs
#'
#' # Terms one level down that expand further
#' onto <- Ontology("liver")
#' onto[onto$relation == "child" & onto$has_children, "name"]
#' }
ontology <- function(term, max_hops = 2, children = TRUE, con = .con()) {
  .need_api(
    con, "ontology",
    why = "The ontology graph is a separate database and is not in the dump."
  )
  check_required(term)

  res <- .api_get(
    con, "/ontology/term",
    term = term,
    max_hops = max_hops,
    # httr2 writes a logical as TRUE/FALSE; the API reads the JSON spelling.
    children = tolower(as.character(isTRUE(children))),
    null_on = 404L
  )
  if (is.null(res)) {
    return(.onto_tibble(list()))
  }

  rows <- c(
    list(.onto_row(res, "term")),
    lapply(.as_record_list(res$synonyms), .onto_row, relation = "synonym"),
    lapply(.as_record_list(res$children), .onto_row, relation = "child")
  )
  out <- .onto_tibble(rows)
  # The server caps synonyms at 500 and children at 300, so say what was cut.
  attr(out, "synonym_total") <- .pnt_int(res$synonym_total)
  attr(out, "children_truncated") <- isTRUE(res$children_truncated)
  attr(out, "max_hops") <- .pnt_int(res$max_hops)
  out
}

#' Map a column of labels to ontology identifiers
#'
#' Free-text labels are what a metadata table holds: "T cell", "hepatocyte",
#' "HeLa". This function looks each label up in the same ontology graph that a
#' search expands with, and puts the identifiers beside it.
#'
#' Each column that you name gets a `<column>_ontology_id` column next to it.
#' The new column holds the source CURIEs for that label, separated by commas:
#' `CL:0000084,MeSH:D013601`. A label that the graph does not have, and an empty
#' cell, become `NA`.
#'
#' Only the identifiers of the label itself are read. Set `use_synonyms = TRUE`
#' to let a label that carries no identifier take the identifiers of its
#' synonyms. This maps more labels, and it trusts more: a synonym link
#' frequently joins a more narrow concept, for example "t cell" to "immature t
#' cell". A label that has its own identifier does not take one from a synonym
#' in either mode.
#'
#' One request goes out for each different label. Rows that repeat a label cost
#' nothing more.
#'
#' Reads the REST API. The ontology graph is a separate database and is not in
#' the dump.
#'
#' @param x A data frame. It is not changed; a copy comes back.
#' @param columns Character. The name of one column, or of several.
#' @param ontology Keep the identifiers of one source only, for example `"CL"`
#'   for cell types or `"UBERON"` for anatomy. The default keeps all of them.
#' @param use_synonyms Let a label with no identifier of its own take the
#'   identifiers of its synonyms. `FALSE` by default.
#' @param max_hops How far to walk the synonym links, 1 to 4. Read only when
#'   `use_synonyms` is `TRUE`.
#' @inheritParams ontology
#'
#' @return `x` with one new character column for each column that you named.
#'
#' @seealso [ontology()] for what the graph holds about one term.
#'
#' @export
#' @examples
#' \dontrun{
#' meta <- data.frame(celltype = c("T cell", "hepatocyte", "HeLa"))
#' MapToOntology(meta, "celltype")
#'
#' # Cell Ontology identifiers alone
#' MapToOntology(meta, "celltype", ontology = "CL")
#'
#' # Let a label with no identifier take one from a synonym
#' MapToOntology(meta, "celltype", use_synonyms = TRUE)
#' }
map_to_ontology <- function(x, columns, ontology = NULL, use_synonyms = FALSE,
                            max_hops = 1, con = .con()) {
  .need_api(
    con, "map_to_ontology",
    why = "The ontology graph is a separate database and is not in the dump."
  )
  check_required(columns)
  if (!is.data.frame(x)) {
    cli::cli_abort("{.arg x} must be a data frame.")
  }
  bad <- setdiff(columns, names(x))
  if (length(bad)) {
    cli::cli_abort("{.arg {bad}} {?is/are} not a column of {.arg x}.")
  }

  labels <- unique(unlist(lapply(x[columns], function(v) trimws(as.character(v)))))
  labels <- labels[!is.na(labels) & nzchar(labels)]
  # `ontology` here names both this argument and the lookup function. R reads a
  # call position as a function, so `ontology(l, ...)` is the lookup and the
  # argument is what filters its answer.
  found <- vapply(labels, function(l) {
    onto <- ontology(l, max_hops = max_hops, children = FALSE, con = con)
    .ontology_ids(onto, ontology, use_synonyms)
  }, character(1))

  for (column in columns) {
    key <- trimws(as.character(x[[column]]))
    x[[paste0(column, "_ontology_id")]] <- unname(found[key])
  }
  x
}

#' The CURIEs for one label: its own, or its synonyms' when it is asked for
#'
#' `onto` is the tibble [ontology()] returns, so the first row is the label
#' itself and the rows after it are its synonyms.
#' @noRd
.ontology_ids <- function(onto, ontology = NULL, use_synonyms = FALSE) {
  if (nrow(onto) == 0) {
    return(NA_character_)
  }
  xrefs <- unlist(onto$xrefs[onto$relation == "term"], use.names = FALSE)
  if (!length(xrefs) && isTRUE(use_synonyms)) {
    xrefs <- unlist(onto$xrefs[onto$relation == "synonym"], use.names = FALSE)
  }
  if (!is.null(ontology)) {
    # CVCL_0030 has no colon, so the prefix ends at whichever comes first.
    xrefs <- xrefs[sub("[:_].*$", "", xrefs) == ontology]
  }
  if (!length(xrefs)) {
    return(NA_character_)
  }
  paste(unique(xrefs), collapse = ",")
}
