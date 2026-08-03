"""Compressed-file IO and per-cell annotation tables shared by the readers."""

from __future__ import annotations

import csv
import io
import logging
import re
import shutil
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

import pandas as pd
from isal import igzip

logger = logging.getLogger(__name__)

_META_FIELD_HINTS: dict[str, tuple[str, ...]] = {
    "subject": (
        "subject",
        "individual",
        "patient",
        "participant",
        "donor",
        "orig.ident",
        "mouse",
        "animal",
    ),
    "sample_id": (
        "sample",
        "sample_id",
        "sampleid",
        "biosample",
        "specimen",
        "aliquot",
        "gsm",
    ),
    "celltype": (
        "celltype",
        "cell_type",
        "cell.type",
        "cell_class",
        "annotation",
        "annot",
        "subtype",
        "cell_subtype",
        "cell_label",
        "majortype",
        "major_type",
        "minortype",
        "minor_type",
        "lineage",
        "population",
        "cell_ontology",
    ),
    "cluster": (
        "cluster",
        "seurat_clusters",
        "leiden",
        "louvain",
        "ident",
        "subcluster",
        "resolution",
    ),
    "tissue": ("tissue", "organ", "region", "site", "compartment", "source_name"),
    "condition": ("condition", "treatment", "disease", "status", "group", "genotype"),
    "sex": ("sex", "gender"),
    "age": ("age", "age_years", "development_stage", "timepoint", "time_point"),
}


def _is_gzip(path: Path) -> bool:
    with path.open("rb") as f:
        return f.read(2) == b"\x1f\x8b"


def _open(path: Path, mode: str = "rt") -> Any:
    """
    Open a possibly-gzipped file transparently.
    """
    if _is_gzip(path):
        return igzip.open(path, mode)
    return path.open(mode)


_SNIFF_BYTES = 8192


def _sniff_delim(head: str) -> str:
    return max(("\t", ",", ";", " "), key=head.count)


def _text(path: Path) -> str:
    """
    Whole file as text.
    """
    with _open(path, "rb") as f:
        return f.read().decode("utf-8", errors="replace")


def _read_rows(path: Path) -> list[list[str]]:
    text = _text(path)
    delim = _sniff_delim(text[:_SNIFF_BYTES])
    return [row for row in csv.reader(text.splitlines(), delimiter=delim) if row]


def _first_column(path: Path) -> list[str]:
    return [row[0] for row in _read_rows(path)]


def _gunzip_beside(path: Path) -> Path:
    """Decompress to a sibling without the .gz suffix, reusing it if present."""
    if not _is_gzip(path):
        return path
    plain = path.with_suffix("")
    if not plain.exists():
        with _open(path, "rb") as src, plain.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    return plain


def _match_field(col: str, hints: tuple[str, ...]) -> bool:
    """Token-aware hint match: age matches age_years, not percentage."""
    low = col.lower()
    tokens = set(re.split(r"[^a-z0-9]+", low))
    for h in hints:
        if h in tokens:
            return True
        # distinctive multi-part hints like orig.ident also match as substrings
        if ("_" in h or "." in h or len(h) >= 8) and h in low:  # noqa: PLR2004
            return True
    return False


def describe_metadata(columns: list[str]) -> dict[str, list[str]]:
    """
    Report which annotation categories a metadata table covers, and via which columns.

    Returns e.g. {"celltype": ["cell_type"], "condition": ["treatment"]}. Keeping
    the source columns rather than a bare flag matters downstream: a condition
    derived from disease_status is not the same variable as one from treatment.
    """
    out: dict[str, list[str]] = {}
    for category, hints in _META_FIELD_HINTS.items():
        matched = [c for c in columns if _match_field(c, hints)]
        if matched:
            out[category] = matched
    return out


def read_metadata(path: Path) -> pd.DataFrame:
    """Read a per-cell annotation table, keyed by whatever its first column is."""
    text = _text(path)
    delim = _sniff_delim(text[:_SNIFF_BYTES])
    # round_trip: pandas' default float parser is off by up to 1 ULP
    frame = pd.read_csv(
        io.StringIO(text), sep=delim, index_col=0, float_precision="round_trip"
    )
    frame.index = frame.index.astype(str)
    return frame
