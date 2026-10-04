test_that("country names and alpha-3 codes convert both ways, NA on a miss", {
  expect_equal(country_code_to_name(c("IND", "usa", "XYZ")), c("India", "United States of America", NA))
  expect_equal(country_name_to_code(c("India", "Atlantis")), c("IND", NA))
  expect_equal(country_name_to_code(country_code_to_name("FRA")), "FRA")
})
