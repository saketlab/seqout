"""The ontology lookup.

Offline: the endpoint is mocked, so what is checked here is the request that
goes out, the shape that comes back, and that a missing term is an answer
rather than an error.
"""

from __future__ import annotations

import pytest
import requests

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
from seqout.exception import SeqoutError

LIVER = {
    "name": "liver",
    "xrefs": ["UBERON:0002107", "MeSH:D008099"],
    "has_children": True,
    "synonyms": [{"name": "iecur", "xrefs": ["UBERON:0002107"]}],
    "synonym_total": 3,
    "children": [
        {"name": "caudate lobe of liver", "has_children": True, "xrefs": ["UBERON:X"]}
    ],
    "children_truncated": False,
    "max_hops": 2,
    "took_ms": 9.7,
}


def _client(payload=LIVER, status=None):
    sq = SeqoutAPIClient()
    seen = {}

    def fake(url, params, response_model):
        seen["url"], seen["params"] = url, params
        if status is not None:
            response = requests.Response()
            response.status_code = status
            raise requests.HTTPError(response=response)
        return response_model.model_validate(payload)

    sq._sender = fake
    return sq, seen


class TestOntology:
    def test_it_reads_the_term_its_synonyms_and_its_children(self):
        sq, _ = _client()
        term = sq.ontology("Liver")
        assert term.name == "liver"
        assert term.xrefs == ["UBERON:0002107", "MeSH:D008099"]
        # synonym_total is the true count; the list is capped by the server.
        assert term.synonym_total == 3
        assert len(term.synonyms) == 1
        assert term.children[0].has_children is True

    def test_sources_names_the_ontologies_behind_the_ids(self):
        sq, _ = _client()
        # CVCL_0030 is a CURIE without a colon, so the prefix has to be read
        # from either separator.
        term = sq.ontology("liver")
        term.xrefs = [*term.xrefs, "CVCL_0030"]
        assert term.sources == ["CVCL", "MeSH", "UBERON"]

    def test_it_asks_the_endpoint_for_what_it_was_given(self):
        sq, seen = _client()
        sq.ontology("liver", 3, children=False)
        assert seen["url"].endswith("/ontology/term")
        assert seen["params"] == {"term": "liver", "max_hops": 3, "children": False}

    def test_a_term_the_graph_lacks_is_none_not_an_error(self):
        sq, _ = _client(status=404)
        assert sq.ontology("zzznope") is None

    def test_any_other_failure_still_raises(self):
        sq, _ = _client(status=500)
        with pytest.raises(requests.HTTPError):
            sq.ontology("liver")

    def test_the_parquet_backend_says_it_has_no_graph(self):
        with pytest.raises(SeqoutError, match="ontology graph"):
            SeqoutParquetClient().ontology("liver")
