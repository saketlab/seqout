liver_response <- list(
  name = "liver",
  xrefs = list("UBERON:0002107", "MeSH:D008099"),
  has_children = TRUE,
  synonyms = list(
    list(name = "iecur", xrefs = list("UBERON:0002107")),
    list(name = "hepatic", xrefs = list())
  ),
  synonym_total = 3L,
  children = list(
    list(
      name = "caudate lobe of liver",
      has_children = TRUE,
      xrefs = list("UBERON:0001117")
    )
  ),
  children_truncated = FALSE,
  max_hops = 2L
)

onto_rows <- function(res) {
  c(
    list(seqout:::.onto_row(res, "term")),
    lapply(seqout:::.as_record_list(res$synonyms), seqout:::.onto_row,
      relation = "synonym"
    ),
    lapply(seqout:::.as_record_list(res$children), seqout:::.onto_row,
      relation = "child"
    )
  )
}

test_that("the term, its synonyms and its children are one tibble", {
  out <- seqout:::.onto_tibble(onto_rows(liver_response))
  expect_s3_class(out, "tbl_df")
  expect_equal(out$relation, c("term", "synonym", "synonym", "child"))
  expect_equal(out$name[1], "liver")
  expect_equal(out$has_children, c(TRUE, FALSE, FALSE, TRUE))
})

test_that("xrefs is a list column, so a term can carry several", {
  out <- seqout:::.onto_tibble(onto_rows(liver_response))
  expect_type(out$xrefs, "list")
  expect_equal(out$xrefs[[1]], c("UBERON:0002107", "MeSH:D008099"))
  # A term with no identifier keeps an empty vector, not NA.
  expect_equal(out$xrefs[[3]], character(0))
})

test_that("a term the graph lacks is an empty tibble, not an error", {
  out <- seqout:::.onto_tibble(list())
  expect_s3_class(out, "tbl_df")
  expect_equal(nrow(out), 0L)
  expect_equal(names(out), c("relation", "name", "xrefs", "has_children"))
})

test_that("ontology refuses a Parquet connection", {
  expect_error(
    ontology("liver", con = fake_con()),
    "reads the REST API"
  )
})

# "t cell" carries its own CL id; "nbc" carries none and has to borrow from a
# synonym one hop away.
graph_tibble <- function(term) {
  rows <- list(
    "t cell" = list(
      seqout:::.onto_row(
        list(name = "t cell", xrefs = list("CL:0000084", "MeSH:D013601")), "term"
      ),
      seqout:::.onto_row(
        list(name = "immature t cell", xrefs = list("CL:0002420")), "synonym"
      )
    ),
    "nbc" = list(
      seqout:::.onto_row(list(name = "nbc", xrefs = list()), "term"),
      seqout:::.onto_row(
        list(name = "naive b cell", xrefs = list("CL:0000788")), "synonym"
      )
    )
  )
  found <- rows[[tolower(term)]]
  seqout:::.onto_tibble(if (is.null(found)) list() else found)
}

test_that("a label takes its own identifiers, and a synonym's only when asked", {
  own <- seqout:::.ontology_ids(graph_tibble("t cell"), use_synonyms = TRUE)
  # The synonym link joins a narrower concept, so CL:0002420 must not ride
  # along while the label has an identifier of its own.
  expect_equal(own, "CL:0000084,MeSH:D013601")

  # "nbc" carries nothing itself: unmapped by default, mapped when the
  # synonyms are asked for.
  expect_true(is.na(seqout:::.ontology_ids(graph_tibble("nbc"))))
  expect_equal(
    seqout:::.ontology_ids(graph_tibble("nbc"), use_synonyms = TRUE),
    "CL:0000788"
  )
  expect_true(is.na(seqout:::.ontology_ids(graph_tibble("zzz"))))
})

test_that("one ontology can be asked for on its own", {
  expect_equal(seqout:::.ontology_ids(graph_tibble("t cell"), "MeSH"), "MeSH:D013601")
  # CVCL_0030 has no colon, so the prefix has to be read from either separator.
  hela <- seqout:::.onto_tibble(list(
    seqout:::.onto_row(list(name = "hela", xrefs = list("CVCL_0030", "EFO:0001185")), "term")
  ))
  expect_equal(seqout:::.ontology_ids(hela, "CVCL"), "CVCL_0030")
  expect_true(is.na(seqout:::.ontology_ids(hela, "CL")))
})

test_that("map_to_ontology adds one column per column, and refuses Parquet", {
  testthat::local_mocked_bindings(ontology = function(term, ...) graph_tibble(term))
  meta <- data.frame(
    celltype = c("T cell", "nbc", "T cell", NA), n = 1:4,
    stringsAsFactors = FALSE
  )

  out <- map_to_ontology(meta, "celltype", use_synonyms = TRUE)
  expect_equal(names(out), c("celltype", "n", "celltype_ontology_id"))
  expect_equal(
    out$celltype_ontology_id,
    c("CL:0000084,MeSH:D013601", "CL:0000788", "CL:0000084,MeSH:D013601", NA)
  )

  # Off by default: "nbc" has no identifier of its own to give.
  expect_equal(
    map_to_ontology(meta, "celltype")$celltype_ontology_id,
    c("CL:0000084,MeSH:D013601", NA, "CL:0000084,MeSH:D013601", NA)
  )

  expect_error(map_to_ontology(meta, "nope"), "not a column")
  expect_error(map_to_ontology(meta, "celltype", con = fake_con()), "REST API")
})
