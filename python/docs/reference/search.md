---
description: SearchParams, StructuredSearchParams, SearchResults and the plan that routes a search.
---

# Search

[`plan_search`][seqout.search_plan.plan_search] selects the endpoint from the
filters and identifies filtering or sorting that the client must apply locally.
See [Search](../library.md#search-for-studies) for filters and examples.

Both parameter models reject undeclared fields to prevent typos from
producing unfiltered searches.

::: seqout.models.api_models.SearchParams

::: seqout.models.api_models.StructuredSearchParams

::: seqout.search_plan.plan_search

::: seqout.search_plan.apply_plan

::: seqout.search_plan.SearchPlan

::: seqout.search_plan.is_boolean_query

::: seqout.models.cohort_models.CohortSample

::: seqout.models.cohort_models.Cohort

::: seqout.models.cohort_models.SingleCellSample

::: seqout.models.cohort_models.SingleCellSamples

::: seqout.models.cohort_models.MicrobeOrganism

::: seqout.models.cohort_models.Microbes

::: seqout.models.api_models.OntologyTerm

::: seqout.models.api_models.OntologyName

::: seqout.models.api_models.SearchResults

::: seqout.models.models.BaseContainer
