test_that("urls come out of the JSON column GEO stores them in", {
  json <- paste0(
    '[{"#text": "ftp://host/GSM1_a.h5ad", "@type": "H5AD"},',
    '{"#text": "ftp://host/GSM1_b.h5ad", "@type": "H5AD"}]'
  )
  expect_equal(
    seqout:::.urls_in_json(json)[[1]],
    c("ftp://host/GSM1_a.h5ad", "ftp://host/GSM1_b.h5ad")
  )
})

test_that("a url key is read as well as a text key", {
  expect_equal(
    seqout:::.urls_in_json('[{"url": "ftp://host/x.mtx.gz"}]')[[1]],
    "ftp://host/x.mtx.gz"
  )
})

test_that("one list is returned per input string, in order", {
  out <- seqout:::.urls_in_json(c('[{"#text": "a"}]', "[]", '[{"#text": "b"}]'))
  expect_length(out, 3)
  expect_equal(out[[1]], "a")
  expect_equal(out[[2]], character(0))
  expect_equal(out[[3]], "b")
})

test_that("a sample with no supplementary data yields no urls", {
  expect_equal(seqout:::.urls_in_json(NA_character_)[[1]], character(0))
  expect_equal(seqout:::.urls_in_json("")[[1]], character(0))
})

test_that("parsed records give the same urls as the raw json", {
  records <- list(
    list(`#text` = "ftp://host/a", `@type` = "H5AD"),
    list(`#text` = "ftp://host/b", `@type` = "H5AD")
  )
  expect_equal(seqout:::.urls_in_records(records), c("ftp://host/a", "ftp://host/b"))
})

test_that("a bare string record is a url on its own", {
  expect_equal(seqout:::.urls_in_records(list("ftp://host/a")), "ftp://host/a")
})

test_that("records carrying neither key are dropped, not turned into NA", {
  expect_equal(
    seqout:::.urls_in_records(list(list(`@type` = "H5AD"), list(`#text` = "ftp://host/a"))),
    "ftp://host/a"
  )
})

test_that("an empty record list gives no urls", {
  expect_equal(seqout:::.urls_in_records(list()), character(0))
  expect_equal(seqout:::.urls_in_records(NULL), character(0))
})
