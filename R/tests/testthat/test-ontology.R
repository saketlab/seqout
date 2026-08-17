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
