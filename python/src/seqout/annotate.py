"""
Label clusters by marker scores.

Inputs use cells by genes.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# sampled values catch normalized matrices without scanning all entries
_SAMPLED_VALUES = 10_000


def _cells_by_genes(x: Any) -> tuple[Any, pd.Index]:
    """Take (matrix, gene names) out of an AnnData, a CountMatrix or a frame."""
    if isinstance(x, pd.DataFrame):
        return x.to_numpy(), x.columns
    var = getattr(x, "var", None)
    if var is not None and getattr(x, "X", None) is not None:
        return x.X, pd.Index(var.index)
    msg = (
        "x must be cells by genes: an AnnData, a CountMatrix, or a DataFrame "
        "whose columns are gene names."
    )
    raise TypeError(msg)


def _looks_like_counts(x: Any) -> bool:
    """Infer raw counts from whole non-negative values."""
    values = x.data if hasattr(x, "nnz") else np.asarray(x).ravel()
    if values.size > _SAMPLED_VALUES:
        values = values[:: max(1, values.size // _SAMPLED_VALUES)]
    return bool(np.all(values >= 0) and np.all(values == np.trunc(values)))


def quick_annotation(
    x: Any,
    clusters: Any,
    markers: dict[str, list[str]],
    normalize: bool | Literal["auto"] = "auto",
) -> pd.Series:
    """
    Label each cluster with its highest-scoring marker set.

    Scores each marker set per cell, averages by cluster, then labels by the
    best set. Marker sets absent from `x` are dropped.

    Scores are unscaled across sets; broad housekeeping sets can win.

    Args:
        x: A cells by genes matrix: an AnnData, a CountMatrix, or a DataFrame.
        clusters: Cluster assignment per cell, one entry per row of `x`.
        markers: Marker gene lists, keyed by cell type.
        normalize: Scale each cell to 10,000 counts and log1p. "auto" does it
            when `x` holds whole numbers.

    Returns:
        Labels indexed by cluster, with the cluster by marker-set score frame
        in `.attrs["scores"]`.

    """
    matrix, genes = _cells_by_genes(x)
    clusters = np.asarray(clusters)
    if len(clusters) != matrix.shape[0]:
        msg = f"clusters has {len(clusters)} entries, x has {matrix.shape[0]} cells"
        raise ValueError(msg)
    if not isinstance(markers, dict) or not markers:
        msg = "markers must be a non-empty dict of gene lists, keyed by cell type"
        raise TypeError(msg)

    position = pd.Series(np.arange(len(genes)), index=genes)
    position = position[~position.index.duplicated()]
    found = {k: [g for g in v if g in position.index] for k, v in markers.items()}
    empty = [k for k, v in found.items() if not v]
    if empty:
        logger.warning("no genes found for %s; dropping", ", ".join(empty))
        found = {k: v for k, v in found.items() if v}
    if not found:
        msg = "none of the marker genes are in x"
        raise ValueError(msg)

    if normalize == "auto":
        normalize = _looks_like_counts(matrix)

    # library size needs every gene; only marker columns are densified
    total = np.asarray(matrix.sum(axis=1)).ravel().astype(float)
    keep = position[sorted({g for v in found.values() for g in v})]
    sub = matrix[:, keep.to_numpy()]
    sub = np.asarray(sub.todense() if hasattr(sub, "todense") else sub, dtype=float)
    if normalize:
        total[total == 0] = 1.0
        sub = np.log1p(sub * (1e4 / total)[:, None])

    at = pd.Series(np.arange(len(keep)), index=keep.index)
    scores = pd.DataFrame(
        {k: sub[:, at[v].to_numpy()].mean(axis=1) for k, v in found.items()}
    )
    by_cluster = scores.groupby(clusters, observed=True).mean()

    labels = pd.Series(
        by_cluster.columns.to_numpy()[by_cluster.to_numpy().argmax(axis=1)],
        index=by_cluster.index,
        name="celltype",
    )
    labels.attrs["scores"] = by_cluster
    return labels
