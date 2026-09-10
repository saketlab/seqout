test_that("citations asks for BibTeX and passes the type through", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get_text = function(con, path, ...) {
      seen <<- list(path = path, args = list(...))
      "@article{X2020,\n}"
    }
  )

  out <- citations("GSE151530", con = rest_con())
  expect_equal(seen$path, "/project/GSE151530/cite")
  expect_equal(seen$args$format, "bibtex")
  expect_equal(seen$args$type, "original")
  expect_match(out, "^@article")

  citations("GSE151530", type = "all", con = rest_con())
  expect_equal(seen$args$type, "all")
})

test_that("a dataset with no paper is character(0), not an error", {
  testthat::local_mocked_bindings(.api_get_text = function(con, path, ...) NULL)
  expect_equal(citations("CRA027437", con = rest_con()), character(0))
})

test_that("citations refuses a type it cannot ask for", {
  expect_error(citations("GSE151530", type = "everything", con = rest_con()))
})


test_that("paper() reads the id kind off the value, so it can be piped", {
  seen <- NULL
  testthat::local_mocked_bindings(
    .api_get = function(con, path, ...) {
      seen <<- list(...)
      NULL
    }
  )

  "34764296" |> paper(con = rest_con())
  expect_equal(seen$pmid, "34764296")
  expect_null(seen$doi)

  "10.1038/s41467-021-26864-x" |> paper(con = rest_con())
  expect_equal(seen$doi, "10.1038/s41467-021-26864-x")
  expect_null(seen$pmid)

  paper(34764296, con = rest_con())
  expect_equal(seen$pmid, "34764296")
})

test_that("paper() with no identifier names all three arguments", {
  expect_error(paper(con = rest_con()), "id")
})

test_that("paper() refuses to guess rather than looking up the wrong paper", {
  expect_error(
    paper("https://doi.org/10.1038/s41467-021-26864-x", con = rest_con()),
    "neither a PubMed ID nor a DOI"
  )
  expect_error(
    paper("34764296", pmid = "34764296", con = rest_con()),
    "not both"
  )
})
