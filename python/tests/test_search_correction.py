"""Offline check for the CLI's augmented-correction merge (dedup + order)."""

from types import SimpleNamespace

from seqout.cli.cli import _merge_augmented


def _row(acc, source="geo"):
    return SimpleNamespace(accession=acc, source=source)


def test_merge_puts_extras_first_and_drops_stream_dupes():
    extra = [_row("GSE301741")]
    stream = [_row("GSE195655"), _row("GSE301741")]  # corrected hit repeats
    out = [(r.source, r.accession) for r in _merge_augmented(extra, iter(stream))]
    assert out == [("geo", "GSE301741"), ("geo", "GSE195655")]


def test_merge_keeps_same_accession_from_a_different_source():
    # dedup is keyed on (source, accession), so a same-id row from another repo stays
    extra = [_row("X1", "geo")]
    stream = [_row("X1", "sra")]
    out = [(r.source, r.accession) for r in _merge_augmented(extra, iter(stream))]
    assert out == [("geo", "X1"), ("sra", "X1")]
