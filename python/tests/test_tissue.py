"""Tissue collection (free-text UBERON term)."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.models.tissue_models import (
    OntologyTermSummary,
    TissueProject,
    TissueProjects,
)


def _row(acc):
    return {"study_accession": acc, "source": "GEO"}


class TestTissueSummaryAndFacets:
    def test_summary_carries_the_resolution(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {
                "studies": 12,
                "term": "liver",
                "resolution": "exact",
                "matched_labels": ["liver"],
            }
        )
        out = sq.fetch_tissue_summary("liver")
        assert isinstance(out, OntologyTermSummary)
        assert out.studies == 12
        assert out.resolution == "exact"

    def test_facets_is_a_dict_of_facet_values(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"organism": [{"value": "Homo sapiens", "studies": 4}]}
        )
        out = sq.fetch_tissue_facets("liver")
        assert out["organism"][0].value == "Homo sapiens"


def _cursor(acc, sort_value=0):
    return {"sort_value": sort_value, "accession": acc}


class TestTissueProjectsPaging:
    """Keyset paging by cursor_sort/cursor_acc."""

    def test_total_rides_beside_the_rows(self, mock_paginated_client):
        sq, _ = mock_paginated_client(
            [{"total": 1, "count": 1, "next_cursor": None, "results": [_row("GSE1")]}]
        )
        out = sq.fetch_tissue_projects("liver")
        assert isinstance(out, TissueProjects)
        assert out.total == 1

    def test_it_pages_by_the_previous_pages_cursor_until_none(
        self, mock_paginated_client
    ):
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 2,
                    "count": 1,
                    "next_cursor": _cursor("GSE1"),
                    "results": [_row("GSE1")],
                },
                {
                    "total": 2,
                    "count": 1,
                    "next_cursor": None,
                    "results": [_row("GSE2")],
                },
            ]
        )
        out = sq.fetch_tissue_projects("liver", limit=None)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert seen[0]["cursor_sort"] is None
        assert seen[0]["cursor_acc"] is None
        assert seen[1]["cursor_sort"] == 0
        assert seen[1]["cursor_acc"] == "GSE1"

    def test_a_null_next_cursor_stops_the_walk_even_with_room_left(
        self, mock_paginated_client
    ):
        # next_cursor decides the last page; a stale total would page forever
        sq, seen = mock_paginated_client(
            [{"total": 9, "count": 0, "next_cursor": None, "results": []}]
        )
        assert len(sq.fetch_tissue_projects("liver")) == 0
        assert len(seen) == 1

    def test_limit_cuts_the_result_and_the_request(self, mock_paginated_client):
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 99,
                    "count": 3,
                    "next_cursor": _cursor("GSE2"),
                    "results": [_row(f"GSE{i}") for i in range(3)],
                }
            ]
        )
        out = sq.fetch_tissue_projects("liver", limit=3)
        assert len(out) == 3
        assert seen[0]["limit"] == 3


class TestParquetRefuses:
    @pytest.mark.parametrize(
        "method",
        ["fetch_tissue_summary", "fetch_tissue_facets", "fetch_tissue_projects"],
    )
    def test_the_dump_has_no_tissue_table(self, method):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="REST API"):
            getattr(pq, method)("liver")


def test_a_container_defaults_its_total_to_the_rows():
    row = TissueProject(study_accession="GSE1", source="GEO")
    assert TissueProjects([row]).total == 1
