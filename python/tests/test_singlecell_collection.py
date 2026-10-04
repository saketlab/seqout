"""Corpus-wide single-cell collection (`fetch_singlecell_*`)."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.models.singlecell_models import SingleCellProject, SingleCellProjects


def _row(acc):
    return {"study_accession": acc}


class TestSingleCellProjects:
    def test_total_rides_beside_the_rows(self, mock_paginated_client):
        sq, _ = mock_paginated_client(
            [{"total": 1, "count": 1, "offset": 0, "results": [_row("GSE1")]}]
        )
        out = sq.fetch_singlecell_projects()
        assert isinstance(out, SingleCellProjects)
        assert out.total == 1
        assert [r.study_accession for r in out] == ["GSE1"]

    def test_it_pages_by_server_offset_until_total_is_reached(
        self, mock_paginated_client
    ):
        sq, seen = mock_paginated_client(
            [
                {"total": 2, "count": 1, "offset": 0, "results": [_row("GSE1")]},
                {"total": 2, "count": 1, "offset": 1, "results": [_row("GSE2")]},
            ]
        )
        out = sq.fetch_singlecell_projects(limit=None)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert seen[1]["offset"] == 1

    def test_limit_cuts_the_result_and_the_request(self, mock_paginated_client):
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 99,
                    "count": 3,
                    "offset": 0,
                    "results": [_row(f"GSE{i}") for i in range(3)],
                }
            ]
        )
        out = sq.fetch_singlecell_projects(limit=3)
        assert len(out) == 3
        assert seen[0]["limit"] == 3


class TestSingleCellSummaryAndFacets:
    def test_summary_is_a_single_object(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"studies": 42033, "n_modalities": 6}
        )
        out = sq.fetch_singlecell_summary()
        assert out.studies == 42033
        assert out.n_modalities == 6

    def test_facets_is_a_dict_of_facet_values(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"chemistry": [{"value": "10x 3' v3", "studies": 100}]}
        )
        out = sq.fetch_singlecell_facets()
        assert out["chemistry"][0].value == "10x 3' v3"
        assert out["chemistry"][0].studies == 100


class TestParquetRefuses:
    @pytest.mark.parametrize(
        "method",
        [
            "fetch_singlecell_summary",
            "fetch_singlecell_facets",
            "fetch_singlecell_projects",
        ],
    )
    def test_the_dump_has_no_singlecell_table(self, method):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="REST API"):
            getattr(pq, method)()


def test_a_container_defaults_its_total_to_the_rows():
    row = SingleCellProject(study_accession="GSE1")
    assert SingleCellProjects([row]).total == 1
