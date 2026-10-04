"""Country-collection paging and shapes."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.models.country_models import CountryProject, CountryProjects


def _row(acc):
    return {"study_accession": acc, "source": "SRA"}


class TestCountryProjects:
    def test_total_rides_beside_the_rows(self, mock_paginated_client):
        sq, _ = mock_paginated_client(
            [{"total": 1, "count": 1, "offset": 0, "results": [_row("GSE1")]}]
        )
        out = sq.fetch_country_projects("US")
        assert isinstance(out, CountryProjects)
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
        out = sq.fetch_country_projects("IN", limit=None)
        assert [r.study_accession for r in out] == ["GSE1", "GSE2"]
        assert seen[1]["offset"] == 1

    def test_an_empty_page_stops_the_walk(self, mock_paginated_client):
        sq, seen = mock_paginated_client(
            [{"total": 9, "count": 0, "offset": 0, "results": []}]
        )
        assert len(sq.fetch_country_projects("US")) == 0
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
        out = sq.fetch_country_projects("US", limit=3)
        assert len(out) == 3
        assert seen[0]["limit"] == 3

    def test_code_is_upper_cased_in_the_url(self):
        sq = SeqoutAPIClient()
        seen_urls = []

        def fake(url, response_model, **kw):
            seen_urls.append(url)
            return response_model.model_validate({"studies": 1})

        sq._sender = fake
        sq.fetch_country_summary("us")
        assert seen_urls[0].endswith("/country/US/summary")


class TestCountrySummaryAndFacets:
    def test_summary_is_a_single_object(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"studies": 10, "studies_human": 4}
        )
        out = sq.fetch_country_summary("US")
        assert out.studies == 10

    def test_facets_is_a_dict_of_facet_values(self):
        sq = SeqoutAPIClient()
        sq._sender = lambda url, response_model, **kw: response_model.model_validate(
            {"organism": [{"value": "Homo sapiens", "studies": 4}]}
        )
        out = sq.fetch_country_facets("US")
        assert out["organism"][0].value == "Homo sapiens"
        assert out["organism"][0].studies == 4


class TestParquetRefuses:
    @pytest.mark.parametrize(
        ("method", "kwargs"),
        [
            ("fetch_country_summary", {"code": "US"}),
            ("fetch_country_facets", {"code": "US"}),
            ("fetch_country_projects", {"code": "US"}),
        ],
    )
    def test_the_dump_has_no_country_table(self, method, kwargs):
        from seqout.clients.parquet import SeqoutParquetClient
        from seqout.exception import SeqoutError

        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        with pytest.raises(SeqoutError, match="REST API"):
            getattr(pq, method)(**kwargs)


def test_a_container_defaults_its_total_to_the_rows():
    assert (
        CountryProjects([CountryProject(study_accession="GSE1", source="SRA")]).total
        == 1
    )
