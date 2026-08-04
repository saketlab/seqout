"""
Format readers for counts matrices.

Every reader returns (X, obs, var) where X is obs x var: cells x genes for
single-cell, samples x genes for bulk. That matches AnnData's orientation, so
CountMatrix.to_anndata() only wraps.
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
    Drop non-RNA rows of a multiome/CITE-seq feature matrix.

    Returns (m, var) unchanged when there is nothing to filter, so both 10x
    readers share one definition of what "Gene Expression only" means.
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

    Chooses the combination whose lengths actually match the matrix, in either
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
    """
    Read a CellRanger .h5 into (cells x genes, obs, var).

    Handles both layouts: v2's per-genome group and v3's /matrix.
    """
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


def read_table(path: Path) -> tuple[Any, pd.DataFrame, pd.DataFrame]:
    """
    Read a delimited counts table into (obs x var, obs, var).

    GEO tables are genes x samples, so this transposes into the obs-major
    orientation every other reader returns.
    """
    with _open(path) as f:
        delim = _sniff_delim(f.readline())

    # the C parser needs a single-character delimiter; inferred dtype keeps gene symbols
    with _open(path, "rb") as fh:
        df = pd.read_csv(fh, sep=delim, index_col=0)
    text_cols = [c for c, dt in df.dtypes.items() if not is_numeric_dtype(dt)]
    if text_cols:
        df = df.drop(columns=text_cols)  # a gene-symbol column rode along

    # array transpose avoids a second full DataFrame copy
    x = df.to_numpy(dtype=np.float32).T
    return x, pd.DataFrame(index=df.columns), pd.DataFrame(index=df.index)
