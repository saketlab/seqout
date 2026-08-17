"""The harmonised cohort and the read-derived screen.

Offline: the endpoints are mocked, so what is checked here is the filter
vocabulary, the paging, and the attributes carried beside the rows.
"""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.cohort import COHORT_FILTERS, check_filters
from seqout.models.cohort_models import (
    Cohort,
    CohortSample,
    MicrobeOrganism,
    Microbes,
    SingleCellSample,
    SingleCellSamples,
)


class TestFilters:
    def test_an_unknown_filter_is_refused(self):
        with pytest.raises(ValueError, match="unknown sample filter"):
            check_filters({"not_a_filter": 1})

    def test_a_near_miss_is_suggested(self):
        with pytest.raises(ValueError, match=r"Did you mean.*tissue"):
            check_filters({"tisue": "liver"})

    def test_the_vocabulary_covers_each_group(self):
        for name in (
            "tissue",  # substring
            "organism",  # exact
            "disease_ontology_id",  # ontology CURIE
            "age_min_years",
            "min_cell_count",  # range
            "microbe",
            "has_viral_reads",  # read-derived
        ):
            assert name in COHORT_FILTERS


class TestSampleSearch:
    def _client(self, pages):
        sq = SeqoutAPIClient()
        seen = []

        def fake(url, params, response_model):
            seen.append(params)
            return response_model.model_validate(pages[len(seen) - 1])

        sq._sender = fake
        return sq, seen

    def test_a_filter_is_required(self):
        with pytest.raises(ValueError, match="at least one filter"):
            SeqoutAPIClient().sample_search()

    def test_an_unsortable_field_is_refused(self):
        with pytest.raises(ValueError, match="sort must be"):
            SeqoutAPIClient().sample_search(tissue="liver", sort="nonsense")

    def test_the_total_and_filters_ride_beside_the_rows(self):
        sq, _ = self._client(
            [
                {
                    "samples": [{"sample": "S1"}],
                    "total": 476,
                    "filters": {"tissue": "liver"},
                }
            ]
        )
        out = sq.sample_search(tissue="liver")
        assert out.total == 476
        assert out.filters == {"tissue": "liver"}

    def test_it_follows_next_offset_to_the_end(self):
        sq, seen = self._client(
            [
                {"samples": [{"sample": "S1"}], "total": 2, "next_offset": 1},
                {"samples": [{"sample": "S2"}], "total": 2, "next_offset": None},
            ]
        )
        out = sq.sample_search(tissue="liver")
        assert [s.sample for s in out] == ["S1", "S2"]
        assert seen[1]["offset"] == 1

    def test_a_page_with_no_rows_stops_the_walk(self):
        # A stale next_offset would otherwise page forever.
        sq, seen = self._client([{"samples": [], "total": 9, "next_offset": 500}])
        assert len(sq.sample_search(tissue="liver")) == 0
        assert len(seen) == 1

    def test_limit_cuts_the_result_and_the_request(self):
        sq, seen = self._client(
            [{"samples": [{"sample": f"S{i}"} for i in range(5)], "total": 99}]
        )
        out = sq.sample_search(tissue="liver", limit=3)
        assert len(out) == 3
        assert seen[0]["limit"] == 3

    def test_descendants_are_expanded_unless_told_otherwise(self):
        sq, seen = self._client([{"samples": [], "total": 0}])
        sq.sample_search(disease_ontology_id="MONDO:0005061")
        assert seen[0]["include_descendants"] is True


class TestContainers:
    def test_a_cohort_defaults_its_total_to_the_rows(self):
        assert Cohort([CohortSample(sample="S1")]).total == 1

    def test_single_cell_carries_the_study_row(self):
        out = SingleCellSamples(
            [SingleCellSample(sample_accession="GSM1", cells=10)],
            n_samples_total=1,
        )
        assert out.n_samples_total == 1
        assert out.study is None  # absent rather than invented

    def test_microbes_reports_whether_it_could_measure(self):
        out = Microbes([MicrobeOrganism(organism="HPV16")], measurable=False)
        assert out.measurable is False
        assert out.detections == []
        assert out.control_kingdoms == []


class TestParquetRefuses:
    @pytest.mark.parametrize(
        ("method", "kwargs"),
        [
            ("sample_search", {"tissue": "liver"}),
            ("fetch_single_cell", {"accession": "GSE1"}),
            ("fetch_microbes", {"accession": "GSM1"}),
        ],
    )
    def test_the_dump_has_neither_table(self, method, kwargs):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="REST API"):
            getattr(pq, method)(**kwargs)
