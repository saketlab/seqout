"""Disease-collection dispatch (curated vs. MONDO term) and paging."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.models.disease_models import (
    DiseaseProject,
    DiseaseProjects,
    DiseaseSummary,
    DiseaseTermProjects,
    OntologyTermSummary,
)


def _curated_row(acc):
    return {"study_accession": acc, "n_samples": 1, "n_diseases": 1}


def _term_row(acc):
    return {"study_accession": acc, "source": "GEO"}


class TestDiseaseSummaryDispatch:
    def test_curated_collection_returns_disease_summary(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"studies": 5}
        )
        out = sq.fetch_disease_summary("rare")
        assert isinstance(out, DiseaseSummary)

    def test_free_text_term_returns_ontology_term_summary(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {
                "studies": 5,
                "term": "fatty liver disease",
                "resolution": "substring",
                "matched_labels": ["fatty liver disease"],
            }
        )
        out = sq.fetch_disease_summary("fatty liver disease")
        assert isinstance(out, OntologyTermSummary)
        assert out.resolution == "substring"

    def test_dispatch_is_keyed_on_the_collection_string_not_the_response(self):
        # the model follows collection, never the response shape
        sq = SeqoutAPIClient()
        seen_models = []

        def fake(url, response_model, **kw):
            seen_models.append(response_model)
            return response_model.model_validate({"studies": 1})

        sq._sender = fake
        sq.fetch_disease_summary("nord")
        sq.fetch_disease_summary("MONDO:0005148")
        assert seen_models == [DiseaseSummary, OntologyTermSummary]


class TestDiseaseProjectsPaging:
    def test_curated_collection_returns_disease_projects(self, mock_paginated_client):
        sq, _ = mock_paginated_client(
            [{"total": 1, "count": 1, "offset": 0, "results": [_curated_row("GSE1")]}]
        )
        out = sq.fetch_disease_projects("rare")
        assert isinstance(out, DiseaseProjects)
        assert out.total == 1

    def test_free_text_term_returns_disease_term_projects(self, mock_paginated_client):
        sq, _ = mock_paginated_client(
            [{"total": 1, "count": 1, "offset": 0, "results": [_term_row("GSE1")]}]
        )
        out = sq.fetch_disease_projects("liver cancer")
        assert isinstance(out, DiseaseTermProjects)
        assert out.total == 1

    def test_it_pages_by_server_offset_until_total_is_reached(
        self, mock_paginated_client
    ):
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 2,
                    "count": 1,
                    "offset": 0,
                    "results": [_curated_row("GSE1")],
                },
                {
                    "total": 2,
                    "count": 1,
                    "offset": 1,
                    "results": [_curated_row("GSE2")],
                },
            ]
        )
        out = sq.fetch_disease_projects("nord", limit=None)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert seen[1]["offset"] == 1

    def test_free_text_term_pages_by_cursor_not_offset(self, mock_paginated_client):
        # the term branch pages by cursor_sort/cursor_acc
        sq, seen = mock_paginated_client(
            [
                {
                    "total": 2,
                    "count": 1,
                    "next_cursor": {"sort_value": 0, "accession": "GSE1"},
                    "results": [_term_row("GSE1")],
                },
                {
                    "total": 2,
                    "count": 1,
                    "next_cursor": None,
                    "results": [_term_row("GSE2")],
                },
            ]
        )
        out = sq.fetch_disease_projects("liver cancer", limit=None)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert "offset" not in seen[0]
        assert seen[0]["cursor_sort"] is None
        assert seen[0]["cursor_acc"] is None
        assert seen[1]["cursor_sort"] == 0
        assert seen[1]["cursor_acc"] == "GSE1"

    def test_sort_none_is_not_sent_so_the_server_can_default_per_mode(
        self, mock_paginated_client
    ):
        sq, seen = mock_paginated_client(
            [{"total": 0, "count": 0, "offset": 0, "results": []}]
        )
        sq.fetch_disease_projects("rare")
        assert seen[0]["sort"] is None


class TestDiseaseFacets:
    def test_facets_is_a_dict_of_facet_values_for_either_mode(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"category": [{"value": "Neurology", "studies": 4}]}
        )
        out = sq.fetch_disease_facets("rare")
        assert out["category"][0].value == "Neurology"


class TestDiseaseAliases:
    def test_aliases_carries_total_and_truncated(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, params, response_model: response_model.model_validate(
            {
                "query": "liver",
                "count": 1,
                "total": 32,
                "truncated": True,
                "results": [
                    {
                        "display_name": "liver cancer",
                        "alias": "liver cancer",
                        "mondo_ids": ["MONDO:0002691"],
                        "sources": ["mondo"],
                    }
                ],
            }
        )
        out = sq.fetch_disease_aliases("liver")
        assert out.total == 32
        assert out.truncated is True
        assert out[0].display_name == "liver cancer"


class TestParquetRefuses:
    @pytest.mark.parametrize(
        ("method", "kwargs"),
        [
            ("fetch_disease_summary", {"collection": "rare"}),
            ("fetch_disease_facets", {"collection": "rare"}),
            ("fetch_disease_projects", {"collection": "rare"}),
            ("fetch_disease_aliases", {"q": "liver"}),
        ],
    )
    def test_the_dump_has_no_disease_table(self, method, kwargs):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="REST API"):
            getattr(pq, method)(**kwargs)


def test_a_container_defaults_its_total_to_the_rows():
    row = DiseaseProject(study_accession="GSE1")
    assert DiseaseProjects([row]).total == 1


class TestDiseasePath:
    def test_curated_name_is_case_insensitive_and_term_is_encoded(self):
        sq = SeqoutAPIClient()
        urls = []

        def fake(url, response_model, **kw):
            urls.append(url)
            return response_model.model_validate({"studies": 1})

        sq._sender = fake
        assert isinstance(sq.fetch_disease_summary(" Rare "), DiseaseSummary)
        sq.fetch_disease_summary("type 1/2 diabetes?")
        assert urls[0].endswith("/disease/rare/summary")
        assert urls[1].endswith("/disease/type%201%2F2%20diabetes%3F/summary")

    def test_offset_is_refused_for_a_free_text_term(self):
        with pytest.raises(ValueError, match="offset"):
            SeqoutAPIClient().fetch_disease_projects("fatty liver", offset=10)
