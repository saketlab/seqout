"""Regression tests for accession conversion (`convert` + the a-to-b commands).

The core join/routing logic runs offline against a fake client, so a broken
mesh, target-token map, or GSM-title parse fails here without touching the API.
A couple of network-marked checks pin the real data shape and skip if offline.
"""

from types import SimpleNamespace

import pytest
from rich.console import Console

from seqout.cli.cli import (
    _CONVERT_COMMANDS,
    _TARGET_COL,
    _convert_one,
    _is_doi,
    _is_pmid,
    _mesh_column,
)

_QUIET = Console(quiet=True)


class FakeSq:
    """One synthetic study SRP1 with 2 experiments (each GSM-titled) and 3 runs.

    SRX1 <- SRR1, SRR2  (sample SRS1, GSM10)
    SRX2 <- SRR3        (sample SRS2, GSM20)
    """

    def fetch_study_runs(self, _study, *, full=False):  # noqa: ARG002
        return [
            SimpleNamespace(
                run_accession="SRR1",
                experiment_accession="SRX1",
                study_accession="SRP1",
            ),
            SimpleNamespace(
                run_accession="SRR2",
                experiment_accession="SRX1",
                study_accession="SRP1",
            ),
            SimpleNamespace(
                run_accession="SRR3",
                experiment_accession="SRX2",
                study_accession="SRP1",
            ),
        ]

    def fetch_study_experiments(self, _study):
        return [
            SimpleNamespace(
                accession="SRX1",
                title="GSM10: a; H. sapiens; RNA-Seq",
                samples=["SRS1"],
            ),
            SimpleNamespace(
                accession="SRX2",
                title="GSM20: b; H. sapiens; RNA-Seq",
                samples=["SRS2"],
            ),
        ]

    def fetch_samples(self, _acc):
        return [SimpleNamespace(accession="GSM10"), SimpleNamespace(accession="GSM20")]

    def fetch_geo_sample_detailed_metadata(self, _gsm):
        return SimpleNamespace(project=SimpleNamespace(accession="GSE1"))

    def gsm_series(self, gsm):
        detail = self.fetch_geo_sample_detailed_metadata(gsm)
        return detail.project.accession if detail.project else None

    def search(self, _params):
        return [SimpleNamespace(accession="SRP1")]

    def resolve_study(self, accession):
        if accession.upper().startswith(("SRP", "ERP", "DRP", "GSE", "PRJ")):
            return accession
        return self.search(None)[0].accession

    def fetch_cross_references(self, _acc):
        return [SimpleNamespace(accession="SRP1")]

    def linked_study(self, acc):
        cands = [
            r.accession
            for r in self.fetch_cross_references(acc)
            if r.accession.upper().startswith(("SRP", "ERP", "DRP", "PRJ"))
        ]
        for c in cands:  # prefer a real study accession over a BioProject
            if c.upper().startswith(("SRP", "ERP", "DRP")):
                return c
        return cands[0] if cands else None

    def fetch_project_metadata(self, _acc):
        return SimpleNamespace(
            pmid="111",
            doi="10.1/x",
            publications=[
                SimpleNamespace(pmid="111", doi="10.1/x"),
                SimpleNamespace(pmid="222", doi="10.2/y"),
            ],
        )

    def find_publication(self, *, pmid=None, doi=None):  # noqa: ARG002
        return SimpleNamespace(
            projects=[
                SimpleNamespace(accession="GSE1", source="geo"),
                SimpleNamespace(accession="SRP1", source="sra"),
            ]
        )


def conv(acc, to_kind):
    return _convert_one(FakeSq(), acc, acc.upper(), to_kind, _QUIET)


@pytest.mark.parametrize(
    ("acc", "to_kind", "expected"),
    [
        ("SRP1", "run", ["SRR1", "SRR2", "SRR3"]),
        ("SRP1", "experiment", ["SRX1", "SRX2"]),
        ("SRP1", "sample", ["SRS1", "SRS2"]),
        ("SRR1", "srx", ["SRX1"]),
        ("SRR1", "srs", ["SRS1"]),
        ("SRR1", "srp", ["SRP1"]),
        ("SRR1", "gsm", ["GSM10"]),
        ("SRX1", "run", ["SRR1", "SRR2"]),
        ("SRX1", "sample", ["SRS1"]),
        ("SRS1", "srx", ["SRX1"]),
        ("SRS1", "run", ["SRR1", "SRR2"]),
        ("GSM10", "srx", ["SRX1"]),
        ("GSM10", "run", ["SRR1", "SRR2"]),
        ("GSM10", "srs", ["SRS1"]),
        ("GSM10", "gse", ["GSE1"]),
        ("GSM10", "srp", ["SRP1"]),
        ("GSE1", "gsm", ["GSM10", "GSM20"]),
        ("SRP1", "pmid", ["111", "222"]),
        ("SRP1", "doi", ["10.1/x", "10.2/y"]),
        ("SRR1", "pmid", ["111", "222"]),  # child resolves to study first
        ("34764296", "srp", ["SRP1"]),
        ("34764296", "gse", ["GSE1"]),
        ("34764296", "study", ["GSE1", "SRP1"]),  # no prefix filter -> all
        ("10.1/x", "gse", ["GSE1"]),
    ],
)
def test_convert_directions(acc, to_kind, expected):
    assert conv(acc, to_kind) == expected


def test_archive_prefixes_route_to_mesh_columns():
    # ENA/DDBJ/GSA source prefixes must map to a mesh column (else no conversion)
    for prefix, col in [
        ("ERP1", "study"),
        ("DRP1", "study"),
        ("CRA1", "study"),
        ("ERR1", "srr"),
        ("DRR1", "srr"),
        ("CRR1", "srr"),
        ("ERX1", "srx"),
        ("CRX1", "srx"),
        ("ERS1", "srs"),
        ("CRS1", "srs"),
        ("GSM1", "gsm"),
    ]:
        assert _mesh_column(prefix) == col, prefix


def test_every_command_target_is_known():
    # a command whose target isn't handled would silently no-op
    special = {"gse", "pmid", "doi"}  # handled outside _TARGET_COL
    for name in _CONVERT_COMMANDS:
        target = name.split("-to-")[1]
        assert target in _TARGET_COL or target in special, name


def test_archive_native_commands_registered():
    for name in ("cra-to-crr", "crr-to-cra", "drp-to-drx", "erp-to-err"):
        assert name in _CONVERT_COMMANDS, name


def test_literature_commands_registered():
    for name in ("srp-to-pmid", "gse-to-pmid", "pmid-to-srp", "doi-to-gse"):
        assert name in _CONVERT_COMMANDS, name


def test_pmid_and_doi_detection():
    assert _is_pmid("34764296")
    assert not _is_pmid("SRP311850")
    assert _is_doi("10.1038/s41467-021-26864-x")
    assert not _is_doi("SRP311850")


@pytest.mark.network
def test_real_gsm_to_srr():
    from seqout import Seqout

    try:
        with Seqout() as sq:
            out = _convert_one(sq, "GSM5206734", "GSM5206734", "srr", _QUIET)
    except Exception as e:
        import requests

        if isinstance(e, (requests.ConnectionError, requests.Timeout)):
            pytest.skip(f"API unreachable: {e}")
        raise
    assert "SRR14049273" in out
