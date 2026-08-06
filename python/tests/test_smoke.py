"""Smoke tests: catch refactor breakages (missing exports/methods, moved models)
and basic per-accession-kind fetch failures.

  uv run pytest                  # all
  uv run pytest -m "not network" # offline: import + wiring checks only

The import/wiring tests need no network and would have caught every refactor
breakage we hit (Seqout alias, ProjectMetadataResult location, the dropped
fetch_geo_sample_detailed_metadata). The `network` tests hit the live API and
skip if it's unreachable.
"""

import importlib

import pytest

# KINDS pins the client methods the CLI calls for each accession type.
KINDS = {
    "GSE": ("GSE100112", "fetch_samples"),
    "GSM": ("GSM2652046", "fetch_geo_sample_detailed_metadata"),
    "SRP": ("SRP324458", "fetch_study_experiments"),
    "SRX": ("SRX11169657", "fetch_sample_detailed_metadata"),
}


def test_all_modules_import():
    for mod in [
        "seqout",
        "seqout.cli",
        "seqout.seqout",
        "seqout.clients.api",
        "seqout.clients.parquet",
    ]:
        importlib.import_module(mod)


def test_package_exports_what_cli_imports():
    import seqout

    # CLI imports these names from seqout.
    for name in ("Seqout", "SearchParams", "StudyRunsResults", "connect_to_seqout"):
        assert hasattr(seqout, name), f"seqout.{name} missing"


@pytest.mark.parametrize("method", sorted({m for _, m in KINDS.values()}))
def test_client_has_methods_cli_calls(method):
    from seqout import Seqout

    assert callable(getattr(Seqout, method, None)), f"Seqout.{method} missing"


@pytest.mark.parametrize(
    "method", ["find_publication", "search_author_projects", "fetch_study_runs"]
)
def test_client_has_lookup_methods(method):
    from seqout import Seqout

    assert callable(getattr(Seqout, method, None)), f"Seqout.{method} missing"


@pytest.mark.network
@pytest.mark.parametrize("kind", list(KINDS))
def test_fetch_each_accession_kind(kind):
    from seqout import Seqout

    acc, method = KINDS[kind]
    try:
        with Seqout() as sq:
            result = getattr(sq, method)(acc)
    except Exception as e:
        if _looks_offline(e):
            pytest.skip(f"API unreachable: {e}")
        raise
    # Parsed live responses catch endpoint URL and Pydantic shape regressions.
    assert result is not None


def _looks_offline(exc: Exception) -> bool:
    import requests

    return isinstance(
        exc, (requests.exceptions.ConnectionError, requests.exceptions.Timeout)
    )
