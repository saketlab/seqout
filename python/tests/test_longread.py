"""Long-read paging, local single_cell filtering and SearchParams."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.models.api_models import SearchParams
from seqout.models.longread_models import LongreadProject, LongreadProjects


def _row(acc, is_single_cell=None):
    return {"study_accession": acc, "is_single_cell": is_single_cell}


class TestLongreadProjects:
    def test_total_rides_beside_the_rows(self, mock_paginated_client):
        sq, _ = mock_paginated_client(
            [{"total": 1, "count": 1, "offset": 0, "results": [_row("GSE1")]}]
        )
        out = sq.fetch_longread_projects()
        assert isinstance(out, LongreadProjects)
        assert out.total == 1
        assert [r.study_accession for r in out] == ["GSE1"]

    def test_it_pages_by_server_offset_until_total_is_reached(
        self, mock_paginated_client
    ):
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 2,
                    "count": 1,
                    "offset": 0,
                    "results": [_row("GSE1")],
                },
                {
                    "total": 2,
                    "count": 1,
                    "offset": 1,
                    "results": [_row("GSE2")],
                },
            ]
        )
        out = sq.fetch_longread_projects(limit=None)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert seen[1]["offset"] == 1

    def test_an_empty_page_stops_the_walk(self, mock_paginated_client):
        # A stale total would otherwise page forever.
        sq, seen = mock_paginated_client(
            [{"total": 9, "count": 0, "offset": 0, "results": []}]
        )
        assert len(sq.fetch_longread_projects()) == 0
        assert len(seen) == 1

    def test_single_cell_filters_locally_and_reads_every_page(
        self, mock_paginated_client
    ):
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 2,
                    "count": 1,
                    "offset": 0,
                    "results": [_row("GSE1", is_single_cell=False)],
                },
                {
                    "total": 2,
                    "count": 1,
                    "offset": 1,
                    "results": [_row("GSE2", is_single_cell=True)],
                },
            ]
        )
        out = sq.fetch_longread_projects(single_cell=True)
        assert [r.study_accession for r in out] == ["GSE2"]
        # single_cell has no server-side parameter
        assert "single_cell" not in seen[0]

    def test_single_cell_with_limit_stops_once_limit_is_met(
        self, mock_paginated_client
    ):
        # Stop once enough sorted rows survive the local filter.
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 3,
                    "count": 2,
                    "offset": 0,
                    "results": [
                        _row("GSE1", is_single_cell=True),
                        _row("GSE2", is_single_cell=True),
                    ],
                }
            ]
        )
        out = sq.fetch_longread_projects(single_cell=True, limit=2)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert len(seen) == 1

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
        out = sq.fetch_longread_projects(limit=3)
        assert len(out) == 3
        assert seen[0]["limit"] == 3


class TestLongreadSummaryFacetsChemistry:
    def test_summary_is_a_single_object(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"studies": 10, "studies_pacbio": 6, "studies_nanopore": 5}
        )
        out = sq.fetch_longread_summary()
        assert out.studies == 10

    def test_facets_is_a_dict_of_facet_values(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"technology": [{"value": "PacBio", "studies": 4}]}
        )
        out = sq.fetch_longread_facets()
        assert out["technology"][0].value == "PacBio"
        assert out["technology"][0].studies == 4

    def test_chemistry_returns_the_run_list_not_the_envelope(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"accession": "GSE1", "runs": [{"run_accession": "SRR1"}]}
        )
        out = sq.fetch_longread_chemistry("GSE1")
        assert [r.run_accession for r in out] == ["SRR1"]

    def test_no_long_read_runs_is_empty_not_an_error(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"accession": "GSE1", "runs": []}
        )
        assert sq.fetch_longread_chemistry("GSE1") == []


def test_search_params_accepts_long_read():
    params = SearchParams(q="liver", long_read=True)
    assert params.long_read is True


class TestParquetRefuses:
    @pytest.mark.parametrize(
        ("method", "kwargs"),
        [
            ("fetch_longread_summary", {}),
            ("fetch_longread_facets", {}),
            ("fetch_longread_projects", {}),
            ("fetch_longread_chemistry", {"accession": "GSE1"}),
        ],
    )
    def test_the_dump_has_no_longread_table(self, method, kwargs):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="REST API"):
            getattr(pq, method)(**kwargs)


class TestContainer:
    def test_a_container_defaults_its_total_to_the_rows(self):
        assert LongreadProjects([LongreadProject(study_accession="GSE1")]).total == 1
