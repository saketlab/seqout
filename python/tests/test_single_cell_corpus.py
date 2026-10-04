"""Single-cell status, summary and corpus paging."""

from __future__ import annotations

import logging

import pytest
import requests

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
from seqout.exception import SeqoutError


def _http_error(status):
    resp = requests.Response()
    resp.status_code = status
    return requests.HTTPError(response=resp)


def _replay(pages):
    """Serve one canned page per request; a page may be an exception to raise."""
    sq = SeqoutAPIClient()
    seen = []

    def fake(url, response_model, params=None, **kw):
        seen.append((url, params))
        page = pages[len(seen) - 1]
        if isinstance(page, Exception):
            raise page
        return response_model.model_validate(page)

    sq._sender = fake
    return sq, seen


def _study(acc, kind):
    return {"study_accession": acc, "kind": kind, "n_independent_evidence": 2}


EVIDENCE = {
    "samples_with_matrix": 2,
    "n_independent_evidence": 2,
    "has_matrix": True,
    "kind": "matrix_and_reads",
    "matrix_accessions": ["GSE168652"],
    "reads_accessions": ["SRP310139"],
}


class TestStatusAndSummary:
    def test_status_flattens_evidence_into_one_row(self):
        sq, seen = _replay(
            [
                {
                    "accession": "GSE168652",
                    "single_cell_status": "measured_single_cell",
                    "in_pentimento": True,
                    "evidence": EVIDENCE,
                }
            ]
        )
        out = sq.single_cell_status(" gse168652 ")
        assert seen[0][0].endswith("/project/GSE168652/single-cell/status")
        assert len(out) == 1
        assert out[0].kind == "matrix_and_reads"
        assert out[0].reads_accessions == ["SRP310139"]
        row = out.to_df().iloc[0]
        assert row["single_cell_status"] == "measured_single_cell"
        assert "evidence" not in out.to_df().columns

    def test_summary_keeps_its_own_field_over_the_evidence_copy(self):
        sq, seen = _replay(
            [
                {
                    "study_accession": "GSE168652",
                    "study_cells": 25642,
                    "samples_with_matrix": 3,
                    "microbe_measured": True,
                    "evidence": EVIDENCE,
                }
            ]
        )
        out = sq.single_cell_summary("GSE168652")
        assert seen[0][0].endswith("/project/GSE168652/single-cell/summary")
        assert out[0].study_cells == 25642
        assert out[0].samples_with_matrix == 3
        assert out[0].kind == "matrix_and_reads"

    @pytest.mark.parametrize(
        "method", ["fetch_single_cell_status", "fetch_single_cell_summary"]
    )
    def test_an_unknown_study_is_empty(self, method):
        sq, _ = _replay([_http_error(404)])
        assert len(getattr(sq, method)("GSE1")) == 0

    def test_a_server_error_is_not_swallowed_as_empty(self):
        sq, _ = _replay([_http_error(500)])
        with pytest.raises(requests.HTTPError):
            sq.fetch_single_cell_status("GSE1")


class TestSingleCellStudies:
    def test_matrix_filters_server_side_and_shrinks_the_page_to_limit(self):
        sq, seen = _replay(
            [
                {
                    "studies": [
                        _study("GSE1", "matrix_only"),
                        _study("GSE2", "matrix_only"),
                    ]
                }
            ]
        )
        out = sq.single_cell_studies(data="matrix", limit=2, min_evidence=2)
        assert seen[0][0].endswith("/single-cell/studies")
        assert seen[0][1] == {
            "min_evidence": 2,
            "require_matrix": "true",
            "limit": 2,
            "offset": 0,
        }
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]

    def test_a_short_page_ends_the_walk(self, monkeypatch):
        monkeypatch.setattr("seqout.clients.api.SINGLE_CELL_STUDIES_PAGE", 2)
        sq, seen = _replay(
            [
                {"studies": [_study("A", "matrix_only"), _study("B", "matrix_only")]},
                {"studies": [_study("C", "matrix_only")]},
            ]
        )
        out = sq.fetch_single_cell_studies(data="matrix")
        assert [r.study_accession for r in out] == ["A", "B", "C"]
        assert [p["offset"] for _, p in seen] == [0, 2]

    def test_local_kinds_read_full_pages_until_limit_is_kept(self, monkeypatch):
        monkeypatch.setattr("seqout.clients.api.SINGLE_CELL_STUDIES_PAGE", 2)
        sq, seen = _replay(
            [
                {"studies": [_study("A", "reads_only"), _study("B", "matrix_only")]},
                {
                    "studies": [
                        _study("C", "matrix_and_reads"),
                        _study("D", "reads_only"),
                    ]
                },
                {"studies": [_study("E", "matrix_reads_unscanned")]},
            ]
        )
        out = sq.fetch_single_cell_studies(data="both", limit=2, offset=5)
        assert [r.study_accession for r in out] == ["C", "E"]
        # limit counts kept rows, not fetched ones
        assert [p["limit"] for _, p in seen] == [2, 2, 2]
        assert [p["offset"] for _, p in seen] == [5, 7, 9]
        assert seen[0][1]["require_matrix"] == "true"

    def test_fastq_keeps_reads_and_does_not_require_a_matrix(self):
        sq, seen = _replay(
            [{"studies": [_study("A", "reads_only"), _study("B", "matrix_only")]}]
        )
        out = sq.fetch_single_cell_studies(data="fastq")
        assert [r.study_accession for r in out] == ["A"]
        assert seen[0][1]["require_matrix"] == "false"

    def test_any_warns_about_reads_only_rows(self, caplog):
        sq, _ = _replay([{"studies": [_study("A", "reads_only")]}])
        with caplog.at_level(logging.WARNING, logger="seqout.clients.api"):
            out = sq.fetch_single_cell_studies()
        assert len(out) == 1
        assert "reads_only" in caplog.text

    def test_a_404_page_is_the_end(self):
        sq, _ = _replay([_http_error(404)])
        assert len(sq.fetch_single_cell_studies(data="matrix")) == 0

    def test_an_unknown_data_choice_is_refused(self):
        with pytest.raises(ValueError, match="data must be one of"):
            SeqoutAPIClient().fetch_single_cell_studies(data="counts")


@pytest.mark.parametrize(
    ("method", "args"),
    [
        ("fetch_single_cell_studies", ()),
        ("fetch_single_cell_status", ("GSE1",)),
        ("fetch_single_cell_summary", ("GSE1",)),
        ("single_cell_studies", ()),
    ],
)
def test_parquet_has_no_pentimento_table(method, args):
    pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
    with pytest.raises(SeqoutError, match="Pentimento"):
        getattr(pq, method)(*args)
