"""Search suggestions, facet counts and filter vocabularies."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
from seqout.exception import SeqoutError


def _client(payload, seen=None):
    sq = SeqoutAPIClient()

    def fake(url, response_model, params=None, **kw):
        if seen is not None:
            seen.append((url, params))
        return response_model.model_validate(payload)

    sq._sender = fake
    return sq


class TestSearchSuggest:
    def test_it_sends_the_query_and_keeps_each_correction(self):
        seen = []
        sq = _client(
            {
                "suggestions": [
                    {
                        "corrected_query": "liver cancer",
                        "corrections": [
                            {"original": "livre", "suggested": "liver", "distance": 1}
                        ],
                    }
                ]
            },
            seen,
        )
        out = sq.search_suggest("  livre cancr ")
        assert seen[0][0].endswith("/search/suggest")
        assert seen[0][1] == {"q": "livre cancr"}
        assert out[0].corrected_query == "liver cancer"
        assert out[0].corrections[0].suggested == "liver"
        assert list(out.to_df().columns) == ["corrected_query", "corrections"]

    def test_a_query_that_needs_no_correction_is_empty(self):
        assert len(_client({"suggestions": []}).fetch_search_suggest("liver")) == 0

    def test_a_blank_query_is_refused_before_the_request(self):
        with pytest.raises(ValueError, match="empty"):
            _client({}).fetch_search_suggest("  ")


class TestSearchFacets:
    PAYLOAD = {  # noqa: RUF012
        "facets": {
            "organism": [
                {"value": "Homo sapiens", "count": 3, "score": 1.5},
                {"value": "Mus musculus", "count": 2, "score": 0.5},
            ],
            "country": [{"value": "USA", "count": 4, "score": 2.0}],
        },
        "total": 6515,
        "max_rank": 1.04,
    }

    def test_rows_are_one_per_facet_value_with_total_and_max_rank(self):
        out = _client(self.PAYLOAD).search_facets("liver cancer")
        df = out.to_df()
        assert list(df.columns) == ["facet", "value", "count", "score"]
        assert df["facet"].tolist() == ["organism", "organism", "country"]
        assert out.total == 6515
        assert out.max_rank == pytest.approx(1.04)

    def test_filters_and_flags_reach_the_request(self):
        seen = []
        sq = _client(self.PAYLOAD, seen)
        sq.fetch_search_facets(
            "liver",
            structured=True,
            exclude_ontology=["mesh", "MeSH"],
            organism="Homo sapiens",
            year_from=2020,
            db=None,
        )
        url, params = seen[0]
        assert url.endswith("/search/facets")
        assert params == {
            "q": "liver",
            "organism": "Homo sapiens",
            "year_from": 2020,
            "structured": "true",
            "exclude_ontology": ["MeSH"],
        }

    def test_an_unknown_filter_is_refused_with_a_suggestion(self):
        with pytest.raises(ValueError, match="Did you mean organism"):
            _client(self.PAYLOAD).fetch_search_facets("liver", organsm="x")

    def test_date_filters_are_not_facet_filters(self):
        # /search/facets ignores date_*; sending it would count the wrong set
        with pytest.raises(ValueError, match="unknown facet filter"):
            _client(self.PAYLOAD).fetch_search_facets("liver", date_from="2020-01-01")

    def test_an_unknown_ontology_is_refused(self):
        with pytest.raises(ValueError, match="unknown ontology"):
            _client(self.PAYLOAD).fetch_search_facets("liver", exclude_ontology=["GO"])


class TestFilterValues:
    VALUES = {"total": 2, "values": [{"value": "RNA-Seq", "count": 9}]}  # noqa: RUF012

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("list_library_strategies", "/filters/library-strategies"),
            ("list_instrument_models", "/filters/instrument-models"),
        ],
    )
    def test_value_endpoints(self, method, path):
        seen = []
        out = getattr(_client(self.VALUES, seen), method)()
        assert seen[0][0].endswith(path)
        assert out.total == 2
        assert out.to_df().to_dict("records") == [{"value": "RNA-Seq", "count": 9}]

    @pytest.mark.parametrize(
        ("method", "path"),
        [("list_journals", "/filters/journals"), ("list_centers", "/filters/centers")],
    )
    def test_limited_endpoints_send_limit(self, method, path):
        seen = []
        getattr(_client(self.VALUES, seen), method)(limit=20)
        assert seen[0][0].endswith(path)
        assert seen[0][1] == {"limit": 20}

    @pytest.mark.parametrize("limit", [0, 5001, 2.5, True])
    def test_a_limit_past_the_server_ceiling_is_refused(self, limit):
        with pytest.raises(ValueError, match="between 1 and 5000"):
            _client(self.VALUES).fetch_journals(limit=limit)

    def test_organisms_as_bare_names(self):
        seen = []
        out = _client({"organisms": ["Homo sapiens", "Mus musculus"]}, seen)
        out = out.list_organisms()
        assert seen[0][1] == {"common_names": "false"}
        assert out.to_df().to_dict("records") == [
            {"scientific_name": "Homo sapiens"},
            {"scientific_name": "Mus musculus"},
        ]

    def test_organisms_with_common_names(self):
        seen = []
        payload = {
            "organisms": [
                {"scientific_name": "Homo sapiens", "common_name": "human"},
                {"scientific_name": "Oryza", "common_name": None},
            ]
        }
        out = _client(payload, seen).list_organisms(common_names=True)
        assert seen[0][1] == {"common_names": "true"}
        assert [o.common_name for o in out] == ["human", None]

    def test_assays_are_labelled_by_level(self):
        seen = []
        payload = {
            "organisms": [{"value": "Homo sapiens", "count": 1}],
            "assay_l1": [{"value": "Transcriptomic", "count": 5}],
            "assay_l2": [{"value": "RNA-seq", "count": 4}],
        }
        out = _client(payload, seen).list_assays(country="Japan")
        assert seen[0][0].endswith("/stats/global-contribution-filters")
        assert seen[0][1] == {"country": "Japan"}
        assert out.to_df().to_dict("records") == [
            {"level": "assay_l1", "value": "Transcriptomic", "count": 5},
            {"level": "assay_l2", "value": "RNA-seq", "count": 4},
        ]

    def test_platforms_carry_per_archive_counts(self):
        payload = {
            "platforms": [
                {
                    "name": "ILLUMINA",
                    "platform": "ILLUMINA",
                    "display_name": "Illumina",
                    "total": 10,
                    "geo": 1,
                    "sra": 2,
                    "ena": 3,
                    "gsa": 4,
                    "dra": 0,
                    "gea": 0,
                }
            ]
        }
        df = _client(payload).list_platforms().to_df()
        assert list(df.columns) == [
            "platform",
            "display_name",
            "total",
            "geo",
            "sra",
            "ena",
            "gsa",
            "dra",
            "gea",
        ]
        assert df.loc[0, "gsa"] == 4


class TestTables:
    def test_api_client_points_at_the_parquet_backend(self):
        with pytest.raises(SeqoutError, match=r"connect\('parquet'\)"):
            SeqoutAPIClient().tables()

    def test_parquet_client_lists_the_dump_tables(self):
        pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
        import duckdb

        pq._conn = duckdb.connect()
        pq._conn.execute("CREATE TABLE geo_series_local AS SELECT 1 AS x")
        df = pq.tables()
        assert list(df.columns) == ["table_name", "table_type", "registered"]
        local = df[df["table_name"] == "geo_series_local"].iloc[0]
        assert local["registered"]
        assert local["table_type"] == "BASE TABLE"
        dump = df[df["table_name"] == "geo_series"].iloc[0]
        assert not dump["registered"]
        assert dump["table_type"] == "VIEW"


@pytest.mark.parametrize(
    ("method", "args"),
    [
        ("fetch_search_suggest", ("liver",)),
        ("fetch_search_facets", ("liver",)),
        ("fetch_organisms", ()),
        ("fetch_library_strategies", ()),
        ("fetch_instrument_models", ()),
        ("fetch_platforms", ()),
        ("fetch_centers", ()),
        ("fetch_journals", ()),
        ("fetch_assays", ()),
        ("list_journals", ()),
        ("search_facets", ("liver",)),
    ],
)
def test_parquet_refuses_rest_only_methods(method, args):
    pq = SeqoutParquetClient.__new__(SeqoutParquetClient)
    with pytest.raises(SeqoutError, match="REST API"):
        getattr(pq, method)(*args)
