test_that("every discovery list is REST only", {
  parquet <- fake_con(backend = "parquet")
  for (f in list(
    list_library_strategies, list_instrument_models, list_journals,
    list_centers, list_organisms, list_assays, list_platforms
  )) {
    expect_error(f(con = parquet), "REST API")
  }
})

test_that("limit is bounded here, so the server never answers 422", {
  expect_error(list_journals(limit = 0, con = rest_con()), "between 1 and 5000")
  expect_error(list_journals(limit = "500", con = rest_con()), "between 1 and 5000")
  expect_equal(seqout:::.cap(5000), 5000L)
})

test_that("common_names must be a flag", {
  expect_error(
    list_organisms(common_names = "yes", con = rest_con()),
    "TRUE"
  )
})

test_that("a filter list comes back with a numeric count", {
  # The endpoints answer {total, values:[{value, count}]}; a count that stays
  # text sorts "9" after "10" for anyone who reorders the result.
  local_mocked_bindings(
    .api_get = function(...) {
      list(total = 2, values = list(
        list(value = "RNA-Seq", count = 900),
        list(value = "WGS", count = 100)
      ))
    }
  )
  out <- list_library_strategies(con = rest_con())
  expect_equal(out$value, c("RNA-Seq", "WGS"))
  expect_type(out$count, "double")
})

test_that("an empty filter list is a typed empty tibble", {
  local_mocked_bindings(.api_get = function(...) list(total = 0, values = list()))
  out <- list_centers(con = rest_con())
  expect_equal(nrow(out), 0)
  expect_named(out, c("value", "count"))
})

test_that("organisms arrive as bare strings without common_names", {
  # The endpoint answers a list of strings there and a list of records with it.
  # Passing the strings to .records_to_tibble() would make a column per name.
  local_mocked_bindings(
    .api_get = function(...) {
      list(organisms = list("Homo sapiens", "Mus musculus"), total = 2)
    }
  )
  out <- list_organisms(con = rest_con())
  expect_named(out, "scientific_name")
  expect_equal(out$scientific_name, c("Homo sapiens", "Mus musculus"))
})

test_that("organisms arrive as records with common_names", {
  local_mocked_bindings(
    .api_get = function(...) {
      list(organisms = list(
        list(scientific_name = "Homo sapiens", common_name = "human")
      ), total = 1)
    }
  )
  out <- list_organisms(common_names = TRUE, con = rest_con())
  expect_equal(out$common_name, "human")
})

test_that("assays come back as both levels, labelled", {
  local_mocked_bindings(
    .api_get = function(...) {
      list(
        assay_l1 = list(list(value = "Transcriptomic", count = 10)),
        assay_l2 = list(
          list(value = "scRNA-Seq", count = 6),
          list(value = "Bulk RNA-Seq", count = 4)
        ),
        organisms = list(list(value = "Homo sapiens", count = 9))
      )
    }
  )
  out <- list_assays(con = rest_con())
  expect_equal(nrow(out), 3)
  expect_equal(unique(out$level), c("assay_l1", "assay_l2"))
  expect_type(out$count, "double")
  # `organisms` rides along on that endpoint; list_organisms() is its home.
  expect_false("organisms" %in% out$level)
})

test_that("an assay list with neither level is a typed empty tibble", {
  local_mocked_bindings(.api_get = function(...) list(took_ms = 1))
  out <- list_assays(con = rest_con())
  expect_equal(nrow(out), 0)
  expect_named(out, c("level", "value", "count"))
})
