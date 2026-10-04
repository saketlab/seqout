"""Write lzf.h5ad: a 40 x 30 CSR h5ad whose X is LZF-compressed (h5py only)."""

from pathlib import Path

import h5py
import numpy as np

cells, genes = 40, 30
dense = np.tile(np.array([0, 0, 1, 0, 2, 0], dtype=np.float32), cells * genes // 6).reshape(cells, genes)
rows, cols = np.nonzero(dense)
indptr = np.searchsorted(rows, np.arange(cells + 1)).astype(np.int32)
with h5py.File(Path(__file__).with_name("lzf.h5ad"), "w") as f:
    f.attrs["encoding-type"] = "anndata"; f.attrs["encoding-version"] = "0.1.0"
    x = f.create_group("X")
    x.attrs["encoding-type"] = "csr_matrix"; x.attrs["encoding-version"] = "0.1.0"
    x.attrs["shape"] = (cells, genes)
    x.create_dataset("data", data=dense[rows, cols], compression="lzf", chunks=True)
    x.create_dataset("indices", data=cols.astype(np.int32), compression="lzf", chunks=True)
    x.create_dataset("indptr", data=indptr, compression="lzf", chunks=True)
    for name, idx in (("obs", [f"cell{i}" for i in range(cells)]), ("var", [f"gene{i}" for i in range(genes)])):
        g = f.create_group(name)
        g.attrs["_index"] = "_index"; g.attrs["encoding-type"] = "dataframe"; g.attrs["encoding-version"] = "0.2.0"; g.attrs["column-order"] = np.array([], dtype=h5py.string_dtype())
        ix = g.create_dataset("_index", data=np.array(idx, dtype=object), dtype=h5py.string_dtype())
        ix.attrs["encoding-type"] = "string-array"; ix.attrs["encoding-version"] = "0.2.0"
    print("sum", dense.sum(), "nnz", len(rows))
