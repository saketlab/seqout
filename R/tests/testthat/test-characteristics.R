channel_record <- function(pairs) {
  list(list(
    Source = "PBMC",
    Molecule = "total RNA",
    `@position` = "1",
    Characteristics = pairs
  ))
}

test_that("characteristics come out of a GEO channel", {
  row <- list(channels = channel_record(list(
    list(`@tag` = "tissue", `#text` = "PBMC"),
    list(`@tag` = "age", `#text` = "45")
  )))
  expect_equal(
    seqout:::.characteristics_of(row),
    list(tissue = "PBMC", age = "45")
  )
})

test_that("a channel wrapped by a tibble list-column is still read", {
  # samples[i, ]$channels nests the channel one level deeper
  row <- list(channels = list(channel_record(list(
    list(`@tag` = "tissue", `#text` = "PBMC")
  ))))
  expect_equal(seqout:::.characteristics_of(row), list(tissue = "PBMC"))
})

test_that("a lone characteristic is read as well as several", {
  row <- list(channels = channel_record(list(
    list(`@tag` = "Sex", `#text` = "female")
  )))
  expect_equal(seqout:::.characteristics_of(row), list(Sex = "female"))
})

test_that("an already flat named list is taken as is", {
  row <- list(characteristics = list(tissue = "liver", age = "60"))
  expect_equal(
    seqout:::.characteristics_of(row),
    list(tissue = "liver", age = "60")
  )
})

test_that("a sample carrying no characteristics gives none", {
  expect_equal(seqout:::.characteristics_of(list()), list())
  expect_equal(seqout:::.characteristics_of(list(channels = NULL)), list())
})

test_that("the characteristics become one column each, beside the record columns", {
  samples <- tibble::tibble(
    accession = c("GSM1", "GSM2"),
    title = c("a", "b"),
    channels = list(
      channel_record(list(list(`@tag` = "tissue", `#text` = "PBMC"))),
      channel_record(list(list(`@tag` = "tissue", `#text` = "liver")))
    )
  )
  out <- seqout:::.unnest_characteristics(samples)
  expect_equal(out$accession, c("GSM1", "GSM2"))
  expect_equal(out$tissue, c("PBMC", "liver"))
  # The nested column it came from is spent.
  expect_false("channels" %in% names(out))
})

test_that("samples with different keys give the union of columns", {
  samples <- tibble::tibble(
    accession = c("GSM1", "GSM2"),
    title = c("a", "b"),
    channels = list(
      channel_record(list(list(`@tag` = "tissue", `#text` = "PBMC"))),
      channel_record(list(list(`@tag` = "age", `#text` = "45")))
    )
  )
  out <- seqout:::.unnest_characteristics(samples)
  expect_true(all(c("tissue", "age") %in% names(out)))
  expect_equal(out$tissue, c("PBMC", NA_character_))
})

test_that("a characteristic that collides with a record column is kept, not dropped", {
  samples <- tibble::tibble(
    accession = "GSM1",
    title = "a",
    channels = list(channel_record(list(list(`@tag` = "title", `#text` = "submitter title"))))
  )
  out <- seqout:::.unnest_characteristics(samples)
  expect_equal(out$title, "a")
  expect_equal(out$title.1, "submitter title")
})

test_that("no samples, or none carrying characteristics, passes through unchanged", {
  expect_equal(nrow(seqout:::.unnest_characteristics(tibble::tibble())), 0L)
  plain <- tibble::tibble(accession = "SRX1", title = "a")
  expect_equal(seqout:::.unnest_characteristics(plain), plain)
})

test_that("a nested field survives as a list column instead of being flattened", {
  records <- list(
    list(accession = "GSM1", channels = channel_record(list(
      list(`@tag` = "tissue", `#text` = "PBMC")
    )))
  )
  out <- seqout:::.records_to_tibble(records)
  expect_true(is.list(out$channels))
  expect_equal(out$channels[[1]][[1]]$Characteristics[[1]]$`#text`, "PBMC")
})

test_that("a flat list field still collapses to a string", {
  out <- seqout:::.records_to_tibble(list(list(organisms = list("a", "b"))))
  expect_equal(out$organisms, "a; b")
})
