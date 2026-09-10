"""
Format readers for counts matrices.

Readers return (X, obs, var), with X as obs x var for AnnData.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

import numpy as np
import pandas as pd
from pandas.api.types import is_numeric_dtype

from seqout.counts_io import (
    _first_column,
    _gunzip_beside,
    _is_gzip,
    _open,
    _read_rows,
    _sniff_delim,
)
from seqout.counts_names import _require

logger = logging.getLogger(__name__)


def _keep_feature_type(m: Any, var: pd.DataFrame, feature_type: str | None) -> Any:
    """
    Drop rows outside the requested 10x feature type.

    Return unchanged when no feature_type column or no subset exists.
    """
    if not feature_type or "feature_type" not in var.columns:
        return m, var
    keep = var["feature_type"] == feature_type
    if not keep.any() or keep.all():
        return m, var
    logger.info("keeping %d/%d %s features", keep.sum(), len(var), feature_type)
    return m[:, keep.to_numpy()], var[keep]


def _drop_label_headers(
    shape: tuple[int, int],
    barcodes: list[str],
    features: list[list[str]],
    name: str,
) -> tuple[list[str], list[list[str]]]:
    """
    Drop a header row from the barcode/feature lists when one is present.

    Chooses the combination whose lengths match the matrix, in either
    orientation.
    """
    for drop_bc in (False, True):
        for drop_ft in (False, True):
            bc = barcodes[1:] if drop_bc else barcodes
            ft = features[1:] if drop_ft else features
            if shape in ((len(ft), len(bc)), (len(bc), len(ft))):
                if drop_bc or drop_ft:
                    logger.info(
                        "%s: dropped a header row from %s",
                        name,
                        " and ".join(
                            n
                            for n, d in (("barcodes", drop_bc), ("features", drop_ft))
                            if d
                        ),
                    )
                return bc, ft
    return barcodes, features


def read_10x_mtx(
    mtx: Path,
    barcodes: Path,
    features: Path,
    *,
    feature_type: str | None = "Gene Expression",
) -> tuple[Any, pd.DataFrame, pd.DataFrame]:
    """Read a 10x MatrixMarket triplet into (cells x genes, obs, var)."""
    sio = _require("scipy.io")
    sparse = _require("scipy.sparse")

    # passing an igzip stream keeps scipy.io.mmread off stdlib gzip
    if _is_gzip(mtx):
        with _open(mtx, "rb") as fh:
            coo = sio.mmread(fh)
    else:
        coo = sio.mmread(str(mtx))

    bc = _first_column(barcodes)
    feat_rows = _read_rows(features)

    bc, feat_rows = _drop_label_headers(coo.shape, bc, feat_rows, mtx.name)

    feat_cols = ["gene_id", "gene_name", "feature_type"][: len(feat_rows[0])]
    var = pd.DataFrame(feat_rows, columns=feat_cols)
    var.index = var.get("gene_id", pd.Series(range(len(var)))).astype(str)
    obs = pd.DataFrame(index=pd.Index(bc, name="barcode"))

    # MatrixMarket convention is genes x cells; GEO submissions also use the transpose
    row, col, shape = coo.row, coo.col, coo.shape
    data = coo.data.astype(np.float32, copy=False)
    del coo  # the float64 COO buffer stays resident while CSR allocates
    if shape == (len(var), len(obs)):
        m = sparse.csr_matrix((data, (col, row)), shape=(len(obs), len(var)))
    elif shape == (len(obs), len(var)):
        m = sparse.csr_matrix((data, (row, col)), shape=shape)
    else:
        msg = (
            f"{mtx.name}: matrix {shape} matches neither "
            f"{len(var)} features x {len(obs)} barcodes nor its transpose"
        )
        raise ValueError(msg)

    m, var = _keep_feature_type(m, var, feature_type)
    return m, obs, var


def read_10x_h5(
    path: Path, *, feature_type: str | None = "Gene Expression"
) -> tuple[Any, pd.DataFrame, pd.DataFrame]:
    """Read CellRanger .h5 layouts into (cells x genes, obs, var)."""
    h5py = _require("h5py")
    sparse = _require("scipy.sparse")

    with h5py.File(path, "r") as f:
        # CellRanger v2 uses per-genome groups, v3 uses /matrix; root sets sort first
        if "matrix" in f:
            grp = f["matrix"]
        else:
            groups = [k for k in f if isinstance(f[k], h5py.Group)]
            if not groups:
                msg = f"{path.name}: no matrix group in the .h5"
                raise ValueError(msg)
            grp = f[groups[0]]

        bc_node = grp.get("barcodes")
        if "shape" in grp:
            n_genes, n_cells = (int(x) for x in grp["shape"][:])
        else:
            # CSC indptr is one longer than columns; max index + 1 gives feature rows
            n_cells = len(grp["indptr"]) - 1 if bc_node is None else len(bc_node)
            n_genes = int(grp["indices"][:].max()) + 1 if len(grp["indices"]) else 0
            logger.info(
                "%s: no /shape dataset, inferred %d genes x %d cells",
                path.name,
                n_genes,
                n_cells,
            )

        m = sparse.csc_matrix(
            (grp["data"][:], grp["indices"].astype(np.int32)[:], grp["indptr"][:]),
            shape=(n_genes, n_cells),
        ).T.tocsr()

        bc = [b.decode() if isinstance(b, bytes) else b for b in grp["barcodes"][:]]

        def _col(*names: str) -> list[str] | None:
            for n in names:
                feats = grp.get("features")
                node = feats[n] if feats is not None and n in feats else grp.get(n)
                if node is not None:
                    return [
                        v.decode() if isinstance(v, bytes) else str(v) for v in node[:]
                    ]
            return None

        ids = _col("id", "genes") or [str(i) for i in range(n_genes)]
        names = _col("name", "gene_names") or ids
        ftypes = _col("feature_type")

    var = pd.DataFrame({"gene_id": ids, "gene_name": names}, index=pd.Index(ids))
    if ftypes:
        var["feature_type"] = ftypes
    obs = pd.DataFrame(index=pd.Index(bc, name="barcode"))

    m, var = _keep_feature_type(m, var, feature_type)
    return m, obs, var


def read_h5ad(path: Path) -> Any:
    """Read the .h5ad as an AnnData (already obs x var), gunzipping it if needed."""
    ad = _require("anndata")
    return ad.read_h5ad(_gunzip_beside(path))


# featureCounts and htseq tables put gene annotation in numeric columns beside
# the sample columns; transposed blindly they would each become an observation
_VAR_COLS = frozenset(
    {
        "length",
        "genelength",
        "gene_length",
        "exonlength",
        "effective_length",
        "efflength",
        "merged_length",
        "start",
        "end",
        "start_position",
        "end_position",
        "width",
        "gc",
        "gc_content",
    }
)


# htseq-count appends its summary rows to the counts; STAR does the same in
# ReadsPerGene.out.tab. Drop summary rows to preserve library-size estimates.
_QC_ROWS = frozenset(
    {
        "no_feature",
        "ambiguous",
        "too_low_aqual",
        "not_aligned",
        "alignment_not_unique",
        "n_unmapped",
        "n_multimapping",
        "n_nofeature",
        "n_ambiguous",
    }
)


def _is_qc_row(label: object) -> bool:
    name = str(label).strip()
    return name.startswith("__") or name.strip("_").lower() in _QC_ROWS


def _headerless(line: str, delim: str) -> bool:
    """
    Whether the first line contains counts.

    htseq-count writes a bare gene/count table; read with an inferred header it
    would lose its first gene and label the sample with a count.
    """
    fields = [f for f in line.rstrip("\n").split(delim) if f]
    if len(fields) < 2:  # noqa: PLR2004
        return False
    for v in fields[1:]:
        try:
            float(v)
        except ValueError:
            return False
    return True


def _headerless_names(path: Path, n: int) -> list[str]:
    """Name the unnamed count columns after the file they came from."""
    stem = path.name.split(".")[0]
    return [stem] if n == 1 else [f"{stem}_{i + 1}" for i in range(n)]


def _annotation_columns(df: pd.DataFrame) -> list[Any]:
    """
    Feature annotation columns in a counts table.

    Text columns anywhere are annotation, since counts are numeric. A numeric
    one is annotation only within the leading block featureCounts
    writes: "GC" and "Start" are also plausible sample names further right.
    """
    out: list[Any] = []
    leading = True
    for c, dt in df.dtypes.items():
        if not is_numeric_dtype(dt):
            out.append(c)
            continue
        if leading and str(c).strip().lower() in _VAR_COLS:
            out.append(c)
            continue
        leading = False
    return out


def read_table(path: Path) -> tuple[Any, pd.DataFrame, pd.DataFrame]:
    """
    Read a delimited counts table into (obs x var, obs, var).

    GEO tables are genes x samples, so transpose. Annotation columns (gene
    symbol and featureCounts gene lengths/coordinates) move to var.
    htseq and STAR summary rows are dropped.
    """
    with _open(path) as f:
        first = f.readline()
    delim = _sniff_delim(first)

    header: int | None = None if _headerless(first, delim) else 0
    # the C parser needs a single-character delimiter; inferred dtype keeps gene symbols
    with _open(path, "rb") as fh:
        df = pd.read_csv(fh, sep=delim, index_col=0, header=header)
    if header is None:
        df.columns = _headerless_names(path, df.shape[1])
        df.index.name = None

    names = df.index.astype(str)
    qc = names.str.startswith("__") | names.str.strip("_").str.lower().isin(_QC_ROWS)
    if qc.any():
        logger.info(
            "%s: dropped %d summary row(s): %s",
            path.name,
            int(qc.sum()),
            list(df.index[qc]),
        )
        df = df[~qc]

    ann = _annotation_columns(df)
    var = df[ann]
    if ann:
        df = df.drop(columns=ann)
    if df.empty:
        msg = (
            f"{path.name}: read as an empty matrix. Split on {delim!r} into "
            f"0 count columns, {len(ann)} annotation column(s) "
            f"({[str(c) for c in ann]}) and {len(df)} row(s)."
        )
        raise ValueError(msg)

    # array transpose avoids a second full DataFrame copy
    x = df.to_numpy(dtype=np.float32).T
    return x, pd.DataFrame(index=df.columns), var
