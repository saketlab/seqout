"""
File-role classification and optional-dependency loading.
"""

from __future__ import annotations

import importlib
import logging
import re
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


_EXTRA_HINTS = {
    "scipy": "counts",
    "h5py": "counts",
    "anndata": "counts",
}


def _require(module: str) -> Any:
    """Import an optional dependency or raise with the extra that provides it."""
    try:
        return importlib.import_module(module)
    except ImportError as e:
        extra = _EXTRA_HINTS[module.split(".", 1)[0]]
        msg = (
            f"reading this format needs {module!r}, from the optional "
            f"{extra!r} extra. install with: uv add 'seqout[{extra}]'"
        )
        raise ImportError(msg) from e


class Role(StrEnum):
    """What a supplementary file is, for grouping and dispatch."""

    Mtx = "mtx"
    Barcodes = "barcodes"
    Features = "features"
    H5 = "h5"
    H5ad = "h5ad"
    Rds = "rds"
    Table = "table"
    Tar = "tar"
    Metadata = "metadata"
    Skip = "skip"


_META_NAME_HINTS = (
    "metadata",
    "meta_data",
    "meta-data",
    "meta.data",
    "_meta.",
    ".meta.",
    "cell_meta",
    "cellmeta",
    "annotation",
    "annot",
    "celltype",
    "cell_type",
    "cell.type",
    "cell_label",
    "phenotype",
    "pdata",
    "obs.csv",
    "obs.tsv",
)

_COUNTS_NAME_HINTS = (
    "count",
    "matrix",
    "expr",
    "umi",
    "tpm",
    "fpkm",
    "cpm",
    "rpkm",
    "dge",
)

_EMBEDDED_METADATA_FORMATS = frozenset({"rds", "h5ad"})

_SIDECARS = (
    "fragments.tsv",
    "readme",
    "md5sum",
    # Visium/spatial sidecars: tables, but neither counts nor per-cell annotation
    "tissue_positions",
    "scalefactors",
    "web_summary",
    "metrics_summary",
)

_BARCODE_NAMES = ("barcodes.tsv", "barcodes.csv", "_barcodes.")
_FEATURE_NAMES = ("features.tsv", "genes.tsv", "features.csv", "genes.csv")

_ROLE_TOKENS = (
    "matrix.mtx",
    "barcodes.tsv",
    "features.tsv",
    "genes.tsv",
    "barcodes.csv",
    "features.csv",
    "genes.csv",
    "matrix.csv",
)

_TENX_DIRS = re.compile(
    r"(filtered|raw)_(feature_bc_matrix|gene_bc_matrices)", re.IGNORECASE
)


def classify(name: str) -> Role:  # noqa: PLR0911, a dispatch table reads best flat
    """Return the role of a supplementary file, from its name alone."""
    low = name.lower().rsplit("/", 1)[-1]
    stem = low.removesuffix(".gz").removesuffix(".bz2")

    if any(s in low for s in _BARCODE_NAMES):
        return Role.Barcodes
    if any(s in low for s in _FEATURE_NAMES):
        return Role.Features
    if ".mtx" in stem:
        return Role.Mtx
    # shares extensions with counts files, so it lands after the matrix formats
    # it would shadow and before Table/Rds. h5ad always carries counts too.
    if (
        stem.endswith((".csv", ".tsv", ".txt", ".rds", ".rda"))
        and any(h in low for h in _META_NAME_HINTS)
        and not any(h in low for h in _COUNTS_NAME_HINTS)
    ):
        return Role.Metadata
    if any(s in low for s in _SIDECARS):
        return Role.Skip
    if stem.endswith(".h5ad"):
        return Role.H5ad
    if stem.endswith((".h5", ".hdf5")):
        return Role.H5
    if stem.endswith((".rds", ".rda", ".rdata")):
        return Role.Rds
    if ".tar" in stem or stem.endswith(".tgz"):
        return Role.Tar
    if stem.endswith((".csv", ".tsv", ".txt")):
        return Role.Table
    return Role.Skip


def group_key(name: str) -> str:
    """
    Shared key for the files of one 10x unit.

    A canonical CellRanger directory wins over the filename; otherwise the
    filename with its compression suffix and terminal role token stripped, so
    GSM123_x_matrix.mtx.gz and GSM123_x_barcodes.tsv.gz land together.
    """
    parts = name.split("/")
    for i, seg in enumerate(parts[:-1]):
        if _TENX_DIRS.search(seg):
            return "/".join(parts[: i + 1]).lower()

    low = parts[-1].lower().removesuffix(".gz").removesuffix(".bz2")
    for token in _ROLE_TOKENS:
        if low.endswith(token):
            return low[: -len(token)].rstrip("._-")
    return low


def is_filtered(name: str) -> bool:
    """CellRanger filtered output; preferred over raw when both exist."""
    low = name.lower()
    return "filtered" in low and "unfiltered" not in low
