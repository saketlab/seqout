---
description: SearchParams, StructuredSearchParams, SearchResults and the plan that routes a search.
---

# Search

Two endpoints answer a project search and they take different filter sets. You
do not choose between them: [`plan_search`][seqout.search_plan.plan_search]
reads the filters, picks the endpoint, and reports whatever the endpoint cannot
do so the client can finish the job. See
[Search](../library.md#search) for the filters and the worked examples.

Both parameter models forbid a field they do not declare. Pydantic's default is
to drop one, which turned a typo into an unfiltered search that looked filtered.

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
