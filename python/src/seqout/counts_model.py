"""
Data model and grouping rules behind SeqoutCounts.

SuppFile is one supplementary file; Unit is the group of files that read as
one matrix; CountMatrix is the result. group() turns a flat file list into
units, which is where 10x triplet assembly and the filtered-over-raw preference
live.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

import pandas as pd

from seqout.counts_names import (
    _EMBEDDED_METADATA_FORMATS,
    Role,
    _require,
    group_key,
    is_filtered,
)

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

# below this many observations a table is bulk, above it per-cell; between the
# two nothing is decided, which is where Smart-seq plates land
_BULK_MAX_OBS = 32
_SC_MIN_OBS = 400

_BARCODE_RE = re.compile(r"^[ACGTN]{12,}(-\d+)?$")

Kind = Literal["single_cell", "bulk", "unknown"]


@dataclass(frozen=True)
class SuppFile:
    """One supplementary file, before download."""

    url: str
    role: Role
    sample: str | None = None
    platform: str | None = None
    member: str | None = None  # path inside a tar, when it came from one

    @property
    def name(self) -> str:
        return self.member or self.url.rsplit("/", 1)[-1]


@dataclass
class Unit:
    """A group of files that read as one matrix."""

    label: str
    fmt: Literal["10x_mtx", "10x_h5", "h5ad", "rds", "table", "tar"]
    files: list[SuppFile]
    sample: str | None = None
    platform: str | None = None
    # set for every unit by _prefer, which group() always runs
    preferred: bool = True
    # per-cell annotation files found alongside the matrix
    metadata_files: list[SuppFile] = field(default_factory=list)

    @property
    def urls(self) -> list[str]:
        return sorted(
            {f.url for f in self.files} | {f.url for f in self.metadata_files}
        )

    @property
    def has_metadata(self) -> bool:
        """Whether per-cell annotation is available, sidecar or embedded."""
        return bool(self.metadata_files) or self.fmt in _EMBEDDED_METADATA_FORMATS


@dataclass
class CountMatrix:
    """
    A counts matrix in AnnData orientation: rows are observations.

    Observations are cells for single-cell data and biological samples for bulk,
    which is what lets one type cover both.
    """

    X: Any  # scipy sparse or numpy, obs x var
    obs: pd.DataFrame
    var: pd.DataFrame
    kind: Kind
    fmt: str
    accession: str | None = None
    source: str = ""
    evidence: list[str] = field(default_factory=list)
    # annotation categories detected in obs, e.g. {"celltype": ["cell_type"]}
    metadata_fields: dict[str, list[str]] = field(default_factory=dict)

    @property
    def has_metadata(self) -> bool:
        return not self.obs.empty and self.obs.shape[1] > 0

    @property
    def shape(self) -> tuple[int, int]:
        return (self.obs.shape[0], self.var.shape[0])

    def __repr__(self) -> str:
        n_obs, n_var = self.shape
        label = "cells" if self.kind == "single_cell" else "obs"
        return (
            f"CountMatrix({self.accession or '?'}, {self.kind}, {self.fmt}, "
            f"{n_obs} {label} x {n_var} genes)"
        )

    def to_anndata(self) -> Any:
        """Wrap as an AnnData; no transpose, the orientation already matches."""
        ad = _require("anndata")
        a = ad.AnnData(X=self.X, obs=self.obs, var=self.var)
        a.uns["seqout"] = {
            "accession": self.accession,
            "kind": self.kind,
            "format": self.fmt,
            "source": self.source,
            "evidence": self.evidence,
            "has_metadata": self.has_metadata,
            "metadata_fields": self.metadata_fields,
        }
        return a

    def to_dataframe(
        self, orientation: Literal["genes_by_obs", "obs_by_genes"] = "genes_by_obs"
    ) -> pd.DataFrame:
        """Dense DataFrame; genes_by_obs is the conventional bulk layout."""
        x = self.X.toarray() if hasattr(self.X, "toarray") else self.X
        df = pd.DataFrame(x, index=self.obs.index, columns=self.var.index)
        return df.T if orientation == "genes_by_obs" else df


_HDF5_MAGIC = b"\x89HDF\r\n\x1a\n"
_SUPERBLOCK_BYTES = 64


def check_hdf5_complete(path: Path, url: str) -> None:
    """
    Raise if an HDF5 file on disk is shorter than its own superblock says.

    An .h5/.h5ad truncated mid-transfer still opens as a file and still
    matches the Content-Length the server sent; only the superblock's stored
    end-of-file catches it. Failing here names the URL instead of surfacing as
    an h5py internal error three frames deep.
    """
    try:
        with path.open("rb") as f:
            if f.read(8) != _HDF5_MAGIC:
                return  # not HDF5 (gzipped h5ad, mtx, tar), nothing to check
            head = f.read(_SUPERBLOCK_BYTES)  # everything after the signature
    except OSError:
        return
    if len(head) < _SUPERBLOCK_BYTES:  # too short to hold a superblock
        return

    version = head[0]
    if version in (0, 1):
        # v0/v1: ... size-of-offsets at byte 13, then a fixed prelude before the
        # base/free-space/EOF address triple (v1 adds 4 bytes for the B-tree K)
        offsets, prelude = head[5], (16 if version == 0 else 20)
    elif version in (2, 3):
        # v2/v3: size-of-offsets moves up to byte 9, triple starts at byte 12
        offsets, prelude = head[1], 4
    else:
        return

    if offsets not in (2, 4, 8):
        return
    eof_field = head[prelude + 2 * offsets : prelude + 3 * offsets]
    stored_eof = int.from_bytes(eof_field, "little")

    actual = path.stat().st_size
    if stored_eof > 0 and actual < stored_eof:
        msg = (
            f"{path.name} is truncated: {actual} bytes on disk, "
            f"{stored_eof} expected. The server served a short body for {url}. "
            f"Delete {path} and retry, or fetch it manually."
        )
        raise OSError(msg)


def gsm_in(name: str) -> str | None:
    """GSM id from a basename; GEO FTP dirs carry a GSM123nnn stub that isn't one."""
    m = re.search(r"GSM\d+", name)
    return m.group(0) if m else None


_TRIPLET_ROLES = frozenset({Role.Mtx, Role.Barcodes, Role.Features})

_ROLE_FMT = {
    Role.H5: "10x_h5",
    Role.H5ad: "h5ad",
    Role.Rds: "rds",
    Role.Tar: "tar",
    Role.Table: "table",
}


def group(files: list[SuppFile], accession: str) -> list[Unit]:
    """
    Group supplementary files into readable units.

    10x triplets group on a shared key (CellRanger dir, else the filename with
    its role token stripped); everything else is its own unit. Within a sample,
    filtered output wins over raw, and a complete triplet or 10x h5 wins over
    a loose table.
    """
    units: list[Unit] = []
    triplets: dict[tuple[str | None, str], list[SuppFile]] = {}
    metadata: dict[str | None, list[SuppFile]] = {}

    for f in files:
        if f.role is Role.Metadata:
            # annotation describes a matrix rather than being one; parked here
            # and attached below, or it would read as a counts table
            metadata.setdefault(f.sample, []).append(f)
            continue
        if f.role in _TRIPLET_ROLES:
            triplets.setdefault((f.sample, group_key(f.name)), []).append(f)
            continue
        units.append(
            Unit(
                label=f.sample or f.name,
                fmt=_ROLE_FMT[f.role],  # type: ignore[arg-type]
                files=[f],
                sample=f.sample,
                platform=f.platform,
            )
        )

    leftovers: dict[str | None, list[SuppFile]] = {}
    for (sample, key), members in triplets.items():
        if not {f.role for f in members} >= _TRIPLET_ROLES:
            leftovers.setdefault(sample, []).extend(members)
            continue
        units.append(
            Unit(
                label=sample or key or accession,
                fmt="10x_mtx",
                files=members,
                sample=sample,
                platform=members[0].platform,
            )
        )

    units += _pair_leftovers(leftovers, accession)
    _attach_metadata(units, metadata)
    return _prefer(units)


def _attach_metadata(
    units: list[Unit], metadata: dict[str | None, list[SuppFile]]
) -> None:
    """
    Give each unit the annotation files that describe it.

    A file named for a sample goes to that sample's units; series-level annotation
    (sample is None) describes the whole study, so it goes to every unit; a
    single GSE1_cell_metadata.csv.gz covering all samples is the common shape.
    """
    shared = metadata.get(None, [])
    for unit in units:
        own = metadata.get(unit.sample, []) if unit.sample is not None else []
        unit.metadata_files = [*own, *shared]
        if unit.metadata_files:
            logger.debug(
                "%s: %d metadata file(s)", unit.label, len(unit.metadata_files)
            )


def _pair_leftovers(
    leftovers: dict[str | None, list[SuppFile]], accession: str
) -> list[Unit]:
    """
    Rescue a triplet whose files share no filename prefix.

    Plenty of submitters ship GSE1_barcodes.tsv.gz + GSE1_features.tsv.gz
    alongside GSE1_someassay_dge.mtx.gz, so the name-derived key splits them
    three ways. When exactly one file of each role is left over within a sample
    scope there is only one pairing possible, so take it; ambiguity (two
    matrices, one barcode file) still declines rather than guessing.
    """
    out: list[Unit] = []
    for sample, members in leftovers.items():
        by_role: dict[Role, list[SuppFile]] = {}
        for f in members:
            by_role.setdefault(f.role, []).append(f)

        if {r: len(v) for r, v in by_role.items()} != dict.fromkeys(_TRIPLET_ROLES, 1):
            logger.info(
                "incomplete 10x group for %s: %s, skipping",
                sample or accession,
                {str(r): [f.name for f in v] for r, v in by_role.items()},
            )
            continue

        files = [by_role[r][0] for r in (Role.Mtx, Role.Barcodes, Role.Features)]
        logger.info(
            "pairing 10x triplet for %s by role, names do not share a prefix: %s",
            sample or accession,
            [f.name for f in files],
        )
        out.append(
            Unit(
                label=sample or accession,
                fmt="10x_mtx",
                files=files,
                sample=sample,
                platform=files[0].platform,
            )
        )
    return out


_FMT_RANK = {"10x_mtx": 0, "10x_h5": 1, "h5ad": 2, "rds": 3, "tar": 4, "table": 5}


def _prefer(units: list[Unit]) -> list[Unit]:
    """
    Mark one unit per sample as preferred.

    Filtered beats raw, then the most structured format wins. The rest stay in
    the list; a sample that ships both a 10x h5 and its mtx triplet should
    still let you ask for the triplet.
    """
    by_sample: dict[str | None, list[Unit]] = {}
    for u in units:
        by_sample.setdefault(u.sample, []).append(u)

    has_per_sample = any(s is not None for s in by_sample)

    for sample, members in by_sample.items():
        if sample is not None and len(members) > 1:
            for u in members:  # labels must stay distinct once a sample has several
                u.label = f"{sample}:{u.fmt}"
        best = min(members, key=_rank)
        for u in members:
            # a series-level file (a bulk table, a _RAW.tar) stays listed but is
            # never auto-selected while per-sample units exist, or matrices()
            # on a whole series would pull a multi-GB archive
            u.preferred = u is best and not (sample is None and has_per_sample)

    return sorted(units, key=lambda u: (u.sample is None, u.label or ""))


def _rank(u: Unit) -> tuple[int, int]:
    filtered = 0 if any(is_filtered(f.name) for f in u.files) else 1
    return (filtered, _FMT_RANK.get(u.fmt, 9))


def infer_kind(obs: pd.DataFrame, n_series_samples: int = 0) -> tuple[Kind, list[str]]:
    """
    Bulk or single-cell, from evidence rather than shape alone.

    Shape is only decisive at the extremes; a 384-column Smart-seq plate sits
    in the middle and stays unknown rather than being mislabeled bulk.
    """
    ev: list[str] = []
    n = len(obs)
    names = [str(i) for i in obs.index[:200]]

    if names and sum(bool(_BARCODE_RE.match(x)) for x in names) > len(names) * 0.5:
        return "single_cell", ["row labels look like cell barcodes"]

    gsm_cols = sum(bool(re.match(r"GSM\d+", x)) for x in names)
    if gsm_cols > len(names) * 0.5:
        ev.append("row labels are GSM accessions")
        return "bulk", ev

    ev.append(f"{n} observations")

    # one observation per GSM at most means observations are samples, not cells
    if n_series_samples and n <= n_series_samples:
        ev.append(
            f"no more observations than the {n_series_samples} samples in the series"
        )
        return "bulk", ev

    if n <= _BULK_MAX_OBS:
        return "bulk", ev
    if n >= _SC_MIN_OBS:
        return "single_cell", ev
    ev.append(f"between {_BULK_MAX_OBS} and {_SC_MIN_OBS}, could be a Smart-seq plate")
    return "unknown", ev
