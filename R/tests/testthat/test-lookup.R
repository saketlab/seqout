rest_con <- function() seqout_connect("api", quiet = TRUE)
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
