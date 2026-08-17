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
