"""
Read .rds counts objects.

Two paths: a pure-Python one that parses the RDS stream and lifts the sparse
slots straight out of Seurat and SingleCellExperiment objects, and an Rscript
fallback for objects only R can unwrap. Neither densifies the matrix.
"""

from __future__ import annotations

import importlib
import logging
import shutil
import subprocess
import tempfile
import warnings
from collections import deque
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from seqout.counts_io import _gunzip_beside, read_metadata
from seqout.counts_names import _require, modality_rank
from seqout.counts_readers import read_10x_mtx

logger = logging.getLogger(__name__)


_RDS_EXPORT_R = r"""
suppressPackageStartupMessages(library(Matrix))
args <- commandArgs(trailingOnly = TRUE)
obj <- readRDS(args[1])
out <- args[2]

counts <- if (inherits(obj, "Seurat")) {
    tryCatch(
        SeuratObject::GetAssayData(obj, layer = "counts"),
        error = function(e) SeuratObject::GetAssayData(obj, slot = "counts")
    )
} else if (inherits(obj, "SingleCellExperiment")) {
    tryCatch(
        SummarizedExperiment::assay(obj, "counts"),
        error = function(e) SummarizedExperiment::assay(obj, 1)
    )
} else if (inherits(obj, "cell_data_set")) {
    SingleCellExperiment::counts(obj)
} else if (inherits(obj, "ExpressionSet")) {
    Biobase::exprs(obj)
} else if (is.list(obj) && !is.data.frame(obj) && length(obj) == 1) {
    obj[[1]]
} else {
    obj
}

if (is.data.frame(counts)) counts <- as.matrix(counts)
counts <- as(as(counts, "CsparseMatrix"), "generalMatrix")

genes <- rownames(counts)
cells <- colnames(counts)
if (is.null(genes)) genes <- paste0("gene", seq_len(nrow(counts)))
if (is.null(cells)) cells <- paste0("cell", seq_len(ncol(counts)))

obs_meta <- if (inherits(obj, "Seurat")) {
    obj@meta.data
} else if (inherits(obj, "SingleCellExperiment")) {
    as.data.frame(SummarizedExperiment::colData(obj))
} else NULL

var_meta <- if (inherits(obj, "SingleCellExperiment")) {
    as.data.frame(SummarizedExperiment::rowData(obj))
} else NULL

dump_meta <- function(df, file) {
    if (!is.null(df) && ncol(df) > 0L) {
        num <- vapply(df, is.numeric, logical(1))
        df[num] <- lapply(df[num], function(x) sprintf("%.17g", x))
        write.table(df, file, sep = "\t", quote = FALSE, col.names = NA)
    }
}
dump_meta(obs_meta, file.path(out, "obs.tsv"))
dump_meta(var_meta, file.path(out, "var.tsv"))

# invisible(): Rscript auto-prints writeMM NULL returns.
invisible(writeMM(counts, file.path(out, "matrix.mtx")))
writeLines(as.character(cells), file.path(out, "barcodes.tsv"))
writeLines(as.character(genes), file.path(out, "features.tsv"))
cat(class(obj)[1], "\n", sep = "")
"""


_MAX_WALK_NODES = 20000

_SPARSE_CLASSES = {"dgCMatrix", "dgTMatrix", "dgRMatrix"}

_LAYER_PREFERENCE = ("counts", "raw", "data")


def _slots(node: Any) -> dict[str, Any] | None:
    """Named children of a parsed R node, whatever container it arrived in."""
    if hasattr(node, "__dict__"):
        return dict(vars(node))
    if isinstance(node, dict):
        return {str(k): v for k, v in node.items()}
    if isinstance(node, (list, tuple)):
        return {str(i): v for i, v in enumerate(node)}
    return None


def _r_class(node: Any) -> str:
    slots = _slots(node)
    if not slots:
        return ""
    cls = slots.get("class")
    if cls is None:
        return ""
    return str(cls[0]) if hasattr(cls, "__len__") and len(cls) else str(cls)


def _find_sparse_matrices(
    root: Any, max_nodes: int = _MAX_WALK_NODES
) -> list[tuple[str, Any, tuple[Any, ...]]]:
    """Every sparse matrix in the object graph, as (path, node, ancestors)."""
    found: list[tuple[str, Any, tuple[Any, ...]]] = []
    queue = deque([("", root, ())])
    seen: set[int] = set()

    while queue and len(seen) < max_nodes:
        path, node, ancestors = queue.popleft()
        if id(node) in seen:
            continue
        seen.add(id(node))

        if _r_class(node) in _SPARSE_CLASSES:
            found.append((path, node, ancestors))
            continue

        slots = _slots(node)
        if not slots:
            continue
        for key, child in slots.items():
            if key in ("class", "factors", "Dimnames"):
                continue
            queue.append((f"{path}/{key}".lower(), child, (*ancestors, node)))
    return found


def _labels(node: Any, n: int) -> list[str] | None:
    """Length-n labels out of whatever container R's names arrived in."""
    if node is None:
        return None
    coords = getattr(node, "coords", None)
    if coords is not None:
        for coord in coords.values():
            if len(coord) == n:
                return [str(v) for v in coord.to_numpy()]
        return None
    try:
        if len(node) == n and not isinstance(node, (str, bytes)):
            return [str(v) for v in node]
    except TypeError:
        return None
    return None


def _axis_names(
    dimnames: Any, axis: int, ancestors: tuple[Any, ...], slot: str, n: int, prefix: str
) -> list[str]:
    """Names for one axis: the matrix's own Dimnames, else the enclosing assay's."""
    try:
        own = _labels(dimnames[axis], n)
    except (TypeError, IndexError, KeyError):
        own = None
    if own:
        return own

    for ancestor in reversed(ancestors):
        slots = _slots(ancestor) or {}
        found = _labels(slots.get(slot), n)
        if found:
            return found

    logger.warning(
        "no %s names in the R object; falling back to positional %s1..%s%d",
        slot,
        prefix,
        prefix,
        n,
    )
    return [f"{prefix}{i + 1}" for i in range(n)]


def _layer_rank(path: str, assay: str | None) -> tuple[int, int, int]:
    """
    Order candidate matrices inside one R object.

    A Seurat object holds an assay per modality and several layers per assay, so
    the assay is chosen first and the raw layer within it second.
    """
    modality = modality_rank(path, assay)
    for i, token in enumerate(_LAYER_PREFERENCE):
        if token in path:
            return (modality, i, len(path))
    return (modality, len(_LAYER_PREFERENCE), len(path))


_OBS_META_TOKENS = ("meta.data", "coldata", "colddata", "phenodata")
_VAR_META_TOKENS = ("rowdata", "elementmetadata", "featuredata", "rowranges")


def _as_frame(node: Any) -> pd.DataFrame | None:
    """Return a parsed R table as a DataFrame: data.frame or Bioconductor DFrame."""
    if isinstance(node, pd.DataFrame):
        return node
    slots = _slots(node)
    if not slots or "listData" not in slots:
        return None
    columns = _slots(slots["listData"]) or {}
    if not columns:
        return None
    try:
        frame = pd.DataFrame(
            {str(k): np.asarray(v).ravel() for k, v in columns.items()}
        )
    except (ValueError, TypeError):
        return None
    labels = _labels(slots.get("rownames"), len(frame))
    if labels:
        frame.index = pd.Index(labels)
    return frame


def _find_metadata(root: Any, n: int, tokens: tuple[str, ...]) -> pd.DataFrame | None:
    """Find the metadata table describing n rows, preferring conventional names."""
    best: tuple[int, pd.DataFrame] | None = None
    queue = deque([("", root)])
    seen: set[int] = set()

    while queue and len(seen) < _MAX_WALK_NODES:
        path, node = queue.popleft()
        if id(node) in seen:
            continue
        seen.add(id(node))

        if _r_class(node) in _SPARSE_CLASSES:
            continue

        frame = _as_frame(node)
        if frame is not None and len(frame) == n and not frame.empty:
            score = 0 if any(t in path for t in tokens) else 1
            if best is None or score < best[0]:
                best = (score, frame)
            if score == 0:
                break

        slots = _slots(node)
        if not slots:
            continue
        for key, child in slots.items():
            if key in ("class", "factors", "Dimnames", "listData"):
                continue
            queue.append((f"{path}/{key}".lower(), child))

    return best[1] if best else None


def _attach(labels: list[str], meta: pd.DataFrame | None, axis: str) -> pd.DataFrame:
    """Index of labels carrying meta's columns, aligned by label when possible."""
    index = pd.Index(labels, name=axis)
    if meta is None:
        return pd.DataFrame(index=index)
    if len(meta) == len(index) and not meta.index.equals(index):
        # R keeps labels and metadata in matrix column order when names disagree
        meta = meta.set_axis(index)
    out = meta.reindex(index)
    logger.info("attached %d %s metadata column(s): %s", out.shape[1], axis, list(out))
    return out


def _rds_via_rdata(
    path: Path, assay: str | None = "rna"
) -> tuple[Any, pd.DataFrame, pd.DataFrame] | None:
    """Extract counts from an .rds with no R installed."""
    try:
        rdata = importlib.import_module("rdata")
    except ImportError:
        return None

    sparse = _require("scipy.sparse")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            obj = rdata.conversion.convert(rdata.parser.parse_file(path))
    except Exception as e:
        logger.debug("rdata could not parse %s (%s); trying R", path.name, e)
        return None

    matrices = _find_sparse_matrices(obj)
    if not matrices:
        logger.debug("no sparse matrix found in %s; trying R", path.name)
        return None

    chosen, node, ancestors = min(matrices, key=lambda pn: _layer_rank(pn[0], assay))
    slots = _slots(node) or {}
    try:
        n_genes, n_cells = (int(d) for d in slots["Dim"])
        m = sparse.csc_matrix(
            (np.asarray(slots["x"], dtype=np.float32), slots["i"], slots["p"]),
            shape=(n_genes, n_cells),
        )
    except (KeyError, ValueError, TypeError) as e:
        logger.debug("unusable sparse slots in %s (%s); trying R", path.name, e)
        return None

    dimnames = slots.get("Dimnames")
    genes = _axis_names(dimnames, 0, ancestors, "features", n_genes, "gene")
    cells = _axis_names(dimnames, 1, ancestors, "cells", n_cells, "cell")

    logger.info(
        "%s: read %s at %s without R (%d cells x %d genes)",
        path.name,
        _r_class(node),
        chosen or "/",
        n_cells,
        n_genes,
    )
    return (
        m.T.tocsr(),
        _attach(cells, _find_metadata(obj, n_cells, _OBS_META_TOKENS), "barcode"),
        _attach(genes, _find_metadata(obj, n_genes, _VAR_META_TOKENS), "gene"),
    )


def read_rds(
    path: Path, assay: str | None = "rna"
) -> tuple[Any, pd.DataFrame, pd.DataFrame]:
    """Read an .rds counts object into (obs x var, obs, var)."""
    path = _gunzip_beside(path)

    direct = _rds_via_rdata(path, assay)
    if direct is not None:
        return direct

    rscript = shutil.which("Rscript")
    if rscript is None:
        msg = (
            f"could not read {path.name}. Install the 'counts' extra for the "
            "pure-Python reader (uv add 'seqout[counts]'), or put R on PATH "
            "with the package that wrote the object."
        )
        raise RuntimeError(msg)

    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "export.R"
        script.write_text(_RDS_EXPORT_R)
        proc = subprocess.run(  # noqa: S603
            [rscript, "--vanilla", str(script), str(path), tmp],
            capture_output=True,
            text=True,
            check=False,
        )
        mtx = Path(tmp) / "matrix.mtx"
        if proc.returncode != 0 or not mtx.exists():
            detail = (proc.stderr or proc.stdout).strip().splitlines()
            msg = (
                f"R could not export counts from {path.name}: "
                f"{detail[-1] if detail else 'no output'}"
            )
            raise ValueError(msg)

        logger.info("%s: unwrapped R class %s", path.name, proc.stdout.strip())
        x, obs, var = read_10x_mtx(
            mtx,
            Path(tmp) / "barcodes.tsv",
            Path(tmp) / "features.tsv",
            feature_type=None,  # r-exported matrices lack a 10x feature_type column
        )
        # R fallback exports Seurat meta.data and Bioconductor colData/rowData
        obs = _attach(list(obs.index), _read_meta_tsv(Path(tmp) / "obs.tsv"), "barcode")
        var = _attach(list(var.index), _read_meta_tsv(Path(tmp) / "var.tsv"), "gene")
        return x, obs, var


def _read_meta_tsv(path: Path) -> pd.DataFrame | None:
    """Read a metadata table R dumped beside the matrix, if it wrote one."""
    return read_metadata(path) if path.exists() else None
