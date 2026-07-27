"""Parquet source resolution: --source (URL or dir) > env > persisted > default."""

from seqout.cli import cli
from seqout.cli.cli import _is_url, _normalize_source, _resolve_parquet_source
from seqout.constants import PARQUET_DUMP_BASE_URL


def test_is_url():
    assert _is_url("https://host/data")
    assert _is_url("http://host")
    assert not _is_url("/var/data/parquet")
    assert not _is_url("./data")


def test_normalize_url_strips_trailing_slash():
    assert _normalize_source("https://host/data/") == "https://host/data"


def test_normalize_local_is_absolute(tmp_path):
    assert _normalize_source(str(tmp_path)) == str(tmp_path.resolve())


def test_flag_beats_env(monkeypatch):
    monkeypatch.setenv("SEQOUT_PARQUET_SOURCE", "https://env/src")
    assert _resolve_parquet_source("https://flag/src/") == "https://flag/src"


def test_env_beats_persisted(monkeypatch):
    monkeypatch.setenv("SEQOUT_PARQUET_SOURCE", "https://env/src")
    monkeypatch.setattr(cli, "_load_parquet_source", lambda: "https://persisted/src")
    assert _resolve_parquet_source(None) == "https://env/src"


def test_persisted_beats_default(monkeypatch):
    monkeypatch.delenv("SEQOUT_PARQUET_SOURCE", raising=False)
    monkeypatch.setattr(cli, "_load_parquet_source", lambda: "https://persisted/src")
    assert _resolve_parquet_source(None) == "https://persisted/src"


def test_default_when_nothing_set(monkeypatch):
    monkeypatch.delenv("SEQOUT_PARQUET_SOURCE", raising=False)
    monkeypatch.setattr(cli, "_load_parquet_source", lambda: None)
    assert _resolve_parquet_source(None) == PARQUET_DUMP_BASE_URL
