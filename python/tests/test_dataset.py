"""Offline tests for the accession-first facade (`sq.get(...)` -> Dataset).

The routing — which archive answers which attribute, and when to hop the link —
runs against a fake client, so a broken hop fails here without touching the API.
"""

from types import SimpleNamespace

import pytest

from seqout.dataset import Dataset, ShortNames, _kind
from seqout.exception import SeqoutError


class FakeSq(ShortNames):
    """GSE1 <-> SRP1 are the same study; GSM1 is a sample of GSE1.

    GSE1 lists samples, SRP1 lists none — so `sq.get("SRP1").samples` must hop
    back to GSE1.
    """

    def __init__(self):
        self.calls = []

    def _log(self, name, arg):
        self.calls.append((name, arg))

    def gsm_series(self, gsm):
        self._log("gsm_series", gsm)
        return "GSE1" if gsm == "GSM1" else None

    def resolve_study(self, acc):
        self._log("resolve_study", acc)
        return "SRP1" if acc.startswith(("SRR", "SRX", "SRS")) else None

    def linked_study(self, acc):
        self._log("linked_study", acc)
        return "SRP1" if acc == "GSE1" else None

    def linked_geo(self, acc):
        self._log("linked_geo", acc)
        return "GSE1" if acc == "SRP1" else None

    def fetch_project_metadata(self, acc):
        self._log("fetch_project_metadata", acc)
        return SimpleNamespace(accession=acc, publications=[SimpleNamespace(pmid="1")])

    def fetch_samples(self, acc):
        self._log("fetch_samples", acc)
        return ["GSM1", "GSM2"] if acc == "GSE1" else []

    def fetch_study_experiments(self, acc):
        self._log("fetch_study_experiments", acc)
        return []  # SRP1 has no experiment rows -> forces the hop to GEO

    def fetch_study_runs(self, acc, *, full=False):
        self._log("fetch_study_runs", (acc, full))
        return [SimpleNamespace(run_accession="SRR1")]

    def fetch_run(self, acc):
        self._log("fetch_run", acc)
        return SimpleNamespace(run_accession=acc)

    def fetch_geo_sample_detailed_metadata(self, acc):
        self._log("fetch_geo_sample_detailed_metadata", acc)
        return SimpleNamespace(accession=acc)


@pytest.mark.parametrize(
    ("accession", "expected"),
    [
        ("GSE1", "series"),
        ("GSM1", "sample"),
        ("SRP1", "study"),
        ("SRX1", "experiment"),
        ("SRS1", "sample"),
        ("SRR1", "run"),
        ("SRA1", "submission"),
        ("ERP9", "study"),
        ("ERR9", "run"),
        ("DRP9", "study"),
        ("DRX9", "experiment"),
        ("CRA1", "study"),
        ("CRX1", "experiment"),
        ("CRR1", "run"),
        ("HRA1", "study"),
        ("HRX1", "experiment"),
        ("HRR1", "run"),
        ("HRS1", "sample"),
        # E-GEAD-N also matches the ArrayExpress four-letter shape.
        ("E-MTAB-1", "series"),
        ("E-GEAD-1086", "series"),
        ("PRJNA1", "study"),
        ("PRJDB1", "study"),
        ("PRJCA1", "study"),
        ("SAMN1", "biosample"),
        ("SAMEA1", "biosample"),
        ("SAMD1", "biosample"),
        ("SAMC1", "biosample"),
        ("  gse1 ", "series"),
        ("lung cancer", None),
        ("GSE", None),
        ("GSE12abc", None),
        ("", None),
    ],
)
def test_kind(accession, expected):
    assert _kind(accession) == expected


def test_unknown_accession_says_what_is_accepted():
    sq = FakeSq()
    with pytest.raises(SeqoutError) as e:
        sq.get("not an accession")
    msg = str(e.value)
    assert "not an accession this library recognizes" in msg
    assert "GSA" in msg
    assert "ArrayExpress" in msg
    assert "sq.search" in msg


def test_unresolvable_child_explains_itself():
    sq = FakeSq()
    with pytest.raises(SeqoutError) as e:
        _ = sq.get("CRR999").project
    msg = str(e.value)
    assert "could not find the study that CRR999" in msg
    assert "a run" in msg
    assert "sq.search" in msg


def test_get_returns_dataset():
    sq = FakeSq()
    d = sq.get(" GSE1 ")
    assert isinstance(d, Dataset)
    assert d.accession == "GSE1"
    assert d.kind == "series"


def test_project_resolves_from_a_child_accession():
    sq = FakeSq()
    assert sq.get("GSM1").project == "GSE1"
    assert sq.get("SRR1").project == "SRP1"
    assert sq.get("GSE1").project == "GSE1"


def test_runs_hop_from_geo_to_the_linked_sra_study():
    sq = FakeSq()
    runs = sq.get("GSE1").runs
    assert [r.run_accession for r in runs] == ["SRR1"]
    # asked SRP1 (not GSE1) and asked for every run, not the 500-row preview
    assert ("fetch_study_runs", ("SRP1", True)) in sq.calls


def test_runs_are_empty_when_nothing_is_linked():
    sq = FakeSq()
    assert len(sq.get("GSE9").runs) == 0
    assert ("fetch_study_runs", ("SRP1", True)) not in sq.calls


def test_samples_hop_back_to_geo_when_the_sra_side_is_empty():
    sq = FakeSq()
    assert sq.get("SRP1").samples == ["GSM1", "GSM2"]


def test_samples_stay_native_when_the_series_has_them():
    sq = FakeSq()
    assert sq.get("GSE1").samples == ["GSM1", "GSM2"]
    assert ("linked_study", "GSE1") not in sq.calls


def test_fields_are_cached():
    sq = FakeSq()
    d = sq.get("GSE1")
    assert d.meta is d.meta
    assert sq.calls.count(("fetch_project_metadata", "GSE1")) == 1


def test_detail_dispatches_on_the_accession_kind():
    sq = FakeSq()
    assert sq.get("SRR1").detail.run_accession == "SRR1"
    assert sq.get("GSM1").detail.accession == "GSM1"
    assert sq.get("GSE1").detail is None


def test_missing_backend_method_says_so():
    """The message must name the field and the way out, not just fail."""
    sq = FakeSq()
    with pytest.raises(SeqoutError, match="not available on the parquet backend"):
        _ = sq.get("GSE1").links


def test_pubs_come_off_the_metadata():
    sq = FakeSq()
    assert [p.pmid for p in sq.get("GSE1").pubs] == ["1"]


def test_channel_accepts_one_or_many_organisms():
    """GEO sends a bare Organism, or a list when the channel mixes species."""
    from seqout.models.api_models import ExperimentSampleChannel

    base = {"Source": "cells", "@position": 1, "Characteristics": []}
    human = {"#text": "Homo sapiens", "@taxid": "9606"}
    mouse = {"#text": "Mus musculus", "@taxid": "10090"}

    one = ExperimentSampleChannel.model_validate({**base, "Organism": human})
    assert one.organism.text == "Homo sapiens"
    assert [o.text for o in one.organisms] == ["Homo sapiens"]

    many = ExperimentSampleChannel.model_validate({**base, "Organism": [human, mouse]})
    assert many.organism.text == "Homo sapiens"  # first, for older callers
    assert [o.text for o in many.organisms] == ["Homo sapiens", "Mus musculus"]

    none = ExperimentSampleChannel.model_validate(base)
    assert none.organism is None
    assert none.organisms == []


def test_not_found_degrades_to_an_empty_result(monkeypatch):
    """A 404 must return an empty result, not raise.

    `requests.Response` is falsy on any error status, so guarding with
    `if exc.response` silently skipped this path.
    """
    import requests

    from seqout.clients.api import SeqoutAPIClient

    r = requests.Response()
    r.status_code = 404
    err = requests.exceptions.HTTPError(response=r)
    assert not r

    sq = SeqoutAPIClient()

    def boom(**_kwargs):
        raise err

    monkeypatch.setattr(sq, "_sender", boom)
    assert len(sq.fetch_project_enriched_metadata("SRP1")) == 0
    assert sq.find_publication(pmid="1").total_projects == 0


def test_experiments_are_empty_for_array_data():
    """AE/GEA series have no sequencing experiments; that is not an error."""
    sq = FakeSq()
    assert len(sq.get("E-MTAB-9").experiments) == 0


def test_detail_refuses_kinds_that_have_no_record():
    sq = FakeSq()
    with pytest.raises(SeqoutError, match="no detail record"):
        _ = sq.get("SRA123").detail


def test_authors_accept_a_list():
    """GSA (CRA/HRA) returns authors as a list; GEO and SRA send a string."""
    from seqout.models.api_models import ProjectMetadataResult

    def built(authors):
        return ProjectMetadataResult.model_validate(
            {"accession": "X", "title": "t", "authors": authors}
        ).authors

    assert built(["Wen-Xiang Liu", "Ada L"]) == "Wen-Xiang Liu, Ada L"
    assert built("Chunbo Li, Keqin Hua") == "Chunbo Li, Keqin Hua"
    assert built([]) is None
    assert built(None) is None


def test_linked_study_falls_back_to_the_bioproject(monkeypatch):
    """GEA files no cross-reference; its BioProject is the only route to runs."""
    from seqout.clients.api import SeqoutAPIClient

    sq = SeqoutAPIClient()
    monkeypatch.setattr(sq, "fetch_cross_references", lambda _acc: [])
    monkeypatch.setattr(
        sq,
        "fetch_project_metadata",
        lambda _acc: SimpleNamespace(bioproject="PRJDB16741"),
    )
    assert sq.linked_study("E-GEAD-657") == "PRJDB16741"


def test_linked_study_prefers_a_cross_reference_over_the_bioproject(monkeypatch):
    from seqout.clients.api import SeqoutAPIClient

    sq = SeqoutAPIClient()
    monkeypatch.setattr(
        sq,
        "fetch_cross_references",
        lambda _acc: [SimpleNamespace(accession="ERP191813")],
    )

    def unexpected(_acc):
        msg = "must not fetch metadata when a cross-reference answers"
        raise AssertionError(msg)

    monkeypatch.setattr(sq, "fetch_project_metadata", unexpected)
    assert sq.linked_study("E-MTAB-16863") == "ERP191813"
