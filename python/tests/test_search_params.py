"""The search params models must refuse what they cannot send.

Pydantic drops an undeclared field by default, which made
``search("liver", assay_l1="…")`` return an unfiltered search that looked
filtered. Every model here sets ``extra="forbid"`` so that fails loudly.
"""

from __future__ import annotations

import inspect

import pytest
from pydantic import ValidationError

from seqout.models.api_models import SearchParams, SearchResult, StructuredSearchParams
from seqout.search_plan import apply_plan, is_boolean_query, plan_search


@pytest.mark.parametrize("model", [SearchParams, StructuredSearchParams])
def test_an_unknown_filter_is_refused(model):
    with pytest.raises(ValidationError) as excinfo:
        model(q="liver", not_a_filter="x")
    assert "not_a_filter" in str(excinfo.value)


@pytest.mark.parametrize("model", [SearchParams, StructuredSearchParams])
def test_a_typo_is_refused_rather_than_ignored(model):
    with pytest.raises(ValidationError) as excinfo:
        model(q="liver", organsim="Homo sapiens")
    assert "organsim" in str(excinfo.value)


def test_the_full_text_filters_survive_the_dump():
    params = SearchParams(
        q="liver",
        country=["Japan"],
        journal=["Nature"],
        instrument_model=["Illumina NovaSeq 6000"],
        multi_platform=True,
        date_from="2024-01-01",
        sortby="citations",
    )
    sent = params.model_dump(exclude_none=True)
    for name in (
        "country",
        "journal",
        "instrument_model",
        "multi_platform",
        "date_from",
        "sortby",
    ):
        assert name in sent, f"{name} never reaches the server"


def test_structured_reads_the_query_as_a_boolean_expression():
    # Unrelated to the /search/structured endpoint: this is boolean parsing of
    # q, forced on a query that carries no operators of its own.
    assert SearchParams(q="liver cancer", structured=True).model_dump(
        exclude_none=True
    )["structured"] is True


def test_the_endpoint_only_declares_what_it_answers():
    # /search/structured has no sortby, order, date_from, date_to or db.
    # FastAPI drops a query parameter it does not declare, so accepting these
    # here would move the silent failure to the server rather than fix it.
    for name, value in (
        ("sortby", "citations"),
        ("order", "asc"),
        ("date_from", "2024-01-01"),
        ("date_to", "2024-01-31"),
        ("db", "geo"),
        ("structured", True),
    ):
        with pytest.raises(ValidationError) as excinfo:
            StructuredSearchParams(q="liver", **{name: value})
        assert name in str(excinfo.value)


def test_the_structured_filters_survive_the_dump():
    params = StructuredSearchParams(
        q="cancer",
        assay_l1="Transcriptomic",
        sample_tissue="liver",
        published_after="2024-01-01",
        pub_date_before="2025-01-01",
        geo_city="Tokyo",
    )
    sent = params.model_dump(exclude_none=True)
    for name in (
        "assay_l1",
        "sample_tissue",
        "published_after",
        "pub_date_before",
        "geo_city",
    ):
        assert name in sent, f"{name} never reaches the server"


def test_the_cli_builds_a_params_object_that_validates():
    # Mirrors cli.py's construction, so a new forbid cannot break the CLI
    # without breaking this first.
    SearchParams(
        q="liver",
        db="geo",
        organism="Homo sapiens",
        library_strategy=["RNA-Seq"],
        library_source=["TRANSCRIPTOMIC"],
        platform=["ILLUMINA"],
        sortby="citations",
        date_from="2024-01-01",
        date_to="2024-01-31",
    )


class TestPlan:
    """The filters pick the endpoint, and the client does what it cannot."""

    def test_a_shared_filter_stays_on_the_full_text_search(self):
        plan = plan_search("liver", country=["Japan"], journal=["Nature"])
        assert not plan.structured_endpoint
        assert not plan.has_local_work

    def test_a_structured_filter_takes_the_other_endpoint(self):
        plan = plan_search("liver", assay_l1="Transcriptomic")
        assert plan.structured_endpoint

    def test_db_and_source_are_spelled_per_endpoint(self):
        assert plan_search("liver", source="geo").params.db == "geo"
        assert plan_search("liver", db="geo", assay_l1="X").params.source == "geo"

    def test_the_day_bounds_are_kept_back_rather_than_dropped(self):
        # The structured endpoint has no date_from, and FastAPI drops a query
        # parameter it does not declare, so sending it would fail in silence.
        plan = plan_search("liver", assay_l1="X", date_from="2024-01-01")
        assert "date_from" not in plan.params.model_dump(exclude_none=True)
        assert plan.date_from == "2024-01-01"
        assert plan.has_local_work

    def test_sortby_is_kept_back_too(self):
        plan = plan_search("liver", assay_l1="X", sortby="citations")
        assert plan.sortby == "citations"
        assert plan.has_local_work

    def test_sortby_rides_along_when_the_endpoint_can_sort(self):
        plan = plan_search("liver", sortby="citations")
        assert plan.params.sortby == "citations"
        assert not plan.has_local_work

    @pytest.mark.parametrize("name", ["year_from", "year_to", "center"])
    def test_the_names_that_meant_two_things_are_gone(self, name):
        with pytest.raises(ValueError, match=name):
            plan_search("liver", **{name: 2020 if "year" in name else "Broad"})

    def test_the_one_pair_no_search_answers(self):
        with pytest.raises(ValueError, match="cannot be combined"):
            plan_search("liver", library_source=["TRANSCRIPTOMIC"], assay_l1="X")

    @pytest.mark.parametrize(
        "query", ['("a" OR "b")', "liver NOT mouse", "immun*", '"a phrase"']
    )
    def test_a_boolean_query_is_refused_rather_than_flattened(self, query):
        with pytest.raises(ValueError, match="boolean"):
            plan_search(query, assay_l1="X")

    def test_prose_is_not_a_boolean_query(self):
        # Lowercase operators are words. Mirrors _TRIGGER in boolean_query.py.
        assert not is_boolean_query("colon or gut")
        assert not is_boolean_query("liver cancer")
        plan_search("colon or gut", assay_l1="X")  # must not raise

    def test_forcing_the_boolean_reading_needs_the_other_endpoint(self):
        with pytest.raises(ValueError, match="boolean"):
            plan_search("liver", structured=True, assay_l1="X")
        assert plan_search("liver", structured=True).params.structured is True


class TestApplyPlan:
    def _rows(self):
        return [
            SearchResult(accession="A", title="a", updated_at="2023-06-01",
                         citation_count=7, journal="Cell"),
            SearchResult(accession="B", title="b", updated_at="2024-06-01",
                         citation_count=108, journal="Ature"),
            SearchResult(accession="C", title="c", updated_at="2025-06-01",
                         citation_count=0, journal="Zoo"),
        ]

    def test_the_day_bounds_use_the_column_the_server_would_have(self):
        plan = plan_search("x", assay_l1="X", date_from="2024-01-01")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["B", "C"]

        plan = plan_search("x", assay_l1="X", date_to="2024-01-01")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["A"]

    def test_a_row_with_no_date_cannot_satisfy_a_bound(self):
        rows = [SearchResult(accession="D", title="d", updated_at=None)]
        plan = plan_search("x", assay_l1="X", date_from="2024-01-01")
        assert apply_plan(rows, plan) == []

    def test_sorting_by_each_field(self):
        plan = plan_search("x", assay_l1="X", sortby="citations")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["B", "A", "C"]

        plan = plan_search("x", assay_l1="X", sortby="citations", order="asc")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["C", "A", "B"]

        plan = plan_search("x", assay_l1="X", sortby="journal", order="asc")
        assert [r.accession for r in apply_plan(self._rows(), plan)] == ["B", "A", "C"]

    def test_nothing_happens_when_there_is_nothing_to_do(self):
        plan = plan_search("liver")
        rows = self._rows()
        assert apply_plan(rows, plan) == rows


class TestOneSearchFunction:
    """search() is the only one, and it answers in full."""

    def test_iter_search_is_gone(self):
        from seqout.clients.api import SeqoutAPIClient

        assert not hasattr(SeqoutAPIClient, "iter_search")
        # The correction is a command-line need, not a second search.
        assert not hasattr(SeqoutAPIClient, "search_with_correction")
        assert hasattr(SeqoutAPIClient, "_search_with_correction")

    def test_search_takes_a_limit(self):
        from seqout.clients.api import SeqoutAPIClient

        sig = inspect.signature(SeqoutAPIClient.search)
        assert "limit" in sig.parameters
        assert sig.parameters["limit"].default is None
