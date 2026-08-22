"""The ontology lookup.

Offline: the endpoint is mocked, so what is checked here is the request that
goes out, the shape that comes back, and that a missing term is an answer
rather than an error.
"""

from __future__ import annotations

import pandas as pd
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


# "t cell" carries its own CL id; "nbc" carries none and has to borrow from a
# synonym one hop away.
GRAPH = {
    "t cell": {
        "name": "t cell",
        "xrefs": ["CL:0000084", "MeSH:D013601"],
        "synonyms": [{"name": "immature t cell", "xrefs": ["CL:0002420"]}],
    },
    "nbc": {
        "name": "nbc",
        "xrefs": [],
        "synonyms": [{"name": "naive b cell", "xrefs": ["CL:0000788"]}],
    },
}


def _graph_client():
    sq = SeqoutAPIClient()
    asked = []

    def fake(url, params, response_model):
        asked.append(params["term"])
        payload = GRAPH.get(params["term"].lower())
        if payload is None:
            response = requests.Response()
            response.status_code = 404
            raise requests.HTTPError(response=response)
        return response_model.model_validate(payload)

    sq._sender = fake
    return sq, asked


class TestMapToOntology:
    def _frame(self):
        return pd.DataFrame({"celltype": ["T cell", "nbc", "T cell", None, "zzz"]})

    def test_it_adds_the_ids_beside_the_column_it_was_given(self):
        sq, asked = _graph_client()
        out = sq.map_to_ontology(self._frame(), "celltype", use_synonyms=True)
        ids = out["celltype_ontology_id"].tolist()

        assert ids[0] == "CL:0000084,MeSH:D013601"
        # A label with no id of its own borrows from one hop away.
        assert ids[1] == "CL:0000788"
        assert ids[2] == ids[0]
        # A blank cell and a label the graph lacks are both NA, not an error.
        assert out["celltype_ontology_id"].isna().tolist() == [
            False,
            False,
            False,
            True,
            True,
        ]
        # One request per distinct label, however many rows repeat it.
        assert sorted(asked) == ["T cell", "nbc", "zzz"]

    def test_a_synonym_never_overrides_an_id_the_label_has_itself(self):
        # The synonym edge joins a narrower concept, so borrowing CL:0002420
        # here would map "T cell" to immature T cells.
        sq, _ = _graph_client()
        out = sq.map_to_ontology(self._frame(), "celltype", use_synonyms=True)
        assert "CL:0002420" not in out["celltype_ontology_id"][0]

    def test_synonyms_are_off_until_they_are_asked_for(self):
        sq, _ = _graph_client()
        ids = sq.map_to_ontology(self._frame(), "celltype")["celltype_ontology_id"]
        # "nbc" carries nothing of its own, so by default it stays unmapped
        # rather than taking the identifier of a term one hop away.
        assert ids[0] == "CL:0000084,MeSH:D013601"
        assert pd.isna(ids[1])

    def test_one_ontology_can_be_asked_for_on_its_own(self):
        sq, _ = _graph_client()
        out = sq.map_to_ontology(
            self._frame(), ["celltype"], ontology="MeSH", use_synonyms=True
        )
        assert out["celltype_ontology_id"][0] == "MeSH:D013601"
        assert out["celltype_ontology_id"].isna()[1]  # CL only

    def test_a_column_that_is_not_there_says_so(self):
        sq, _ = _graph_client()
        with pytest.raises(KeyError, match="nope"):
            sq.map_to_ontology(self._frame(), "nope")
