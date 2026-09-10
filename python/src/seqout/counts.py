"""
Read a GEO accession as a counts matrix.

Downloads start only when raw(), matrix(), or anndata() is called.
"""

from __future__ import annotations

import logging
import tarfile
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal, Self

import numpy as np
import pandas as pd

from seqout import counts_ftp
from seqout.counts_io import describe_metadata, read_metadata
from seqout.counts_model import (
    CountMatrix,
    SuppFile,
    Unit,
    check_hdf5_complete,
    group,
    gsm_in,
    infer_kind,
)
from seqout.counts_names import Role, _require, classify
from seqout.counts_rds import read_rds
from seqout.counts_readers import read_10x_h5, read_10x_mtx, read_h5ad, read_table
from seqout.utils import sample_frame

logger = logging.getLogger(__name__)

_ASSAY_FEATURE_TYPE = {
    "rna": "Gene Expression",
    "adt": "Antibody Capture",
    "hto": "Antibody Capture",
    "atac": "Peaks",
}
_FROM_ASSAY = object()


class SeqoutCounts:
    """
    Lazy reader for GEO counts matrices.

    Args:
        accession: A GSE or GSM; equivalent to passing gse= or gsm=.
        gse: GEO series accession.
        gsm: GEO sample accession.
        client: Existing API client. The parquet backend is unsupported for counts.
        cache_dir: Download cache. Defaults to ~/.cache/seqout/counts/<accession>.
        assay: Preferred assay for multi-assay samples or R objects. Also sets
            10x feature rows unless feature_type overrides it.
        feature_type: 10x feature class to keep. None keeps every row.
        progress: Show download and read progress. False silences it.
        sample_metadata: Attach study-level sample characteristics to obs.

    """

    def __init__(
        self,
        accession: str | None = None,
        *,
        gse: str | None = None,
        gsm: str | None = None,
        client: Any = None,
        cache_dir: Path | str | None = None,
        feature_type: str | None | object = _FROM_ASSAY,
        assay: str | None = "rna",
        progress: bool = True,
        sample_metadata: bool = True,
    ) -> None:
        acc = accession or gse or gsm
        if not acc:
            msg = "pass an accession, gse= or gsm="
            raise ValueError(msg)
        if sum(x is not None for x in (accession, gse, gsm)) > 1:
            msg = "pass only one of accession, gse=, gsm="
            raise ValueError(msg)

        self.accession = acc.strip().upper()
        if not self.accession.startswith(("GSE", "GSM")):
            msg = f"{self.accession}: only GSE and GSM accessions are supported"
            raise ValueError(msg)

        if client is not None and not hasattr(
            client, "fetch_geo_sample_detailed_metadata"
        ):
            msg = (
                f"{type(client).__name__} cannot back SeqoutListCounts: it has no "
                "fetch_geo_sample_detailed_metadata. Pass a client from "
                "connect('api') or connect('parquet'), or omit client= to open one."
            )
            raise TypeError(msg)

        self.assay = assay
        self.progress = progress
        self.sample_metadata = sample_metadata
        self.feature_type = (
            _ASSAY_FEATURE_TYPE.get(assay or "")
            if feature_type is _FROM_ASSAY
            else feature_type
        )
        self._client = client
        self._owns_client = client is None
        self._cache = Path(
            cache_dir or Path.home() / ".cache" / "seqout" / "counts" / self.accession
        )
        self._n_samples = 0
        self._meta_cache: dict[Path, pd.DataFrame] = {}
        self._samples: list[Any] = []
        self._design: pd.DataFrame | None = None
        self._files: list[SuppFile] | None = None
        self._units: list[Unit] | None = None

    def __repr__(self) -> str:
        n = len(self._units) if self._units is not None else "?"
        return f"SeqoutListCounts({self.accession}, {n} unit(s))"

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        """Close the client when this object opened it."""
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None

    @property
    def client(self) -> Any:
        """The API client, opened on first use when none was passed in."""
        if self._client is None:
            from seqout.seqout import connect  # noqa: PLC0415, avoids an import cycle

            self._client = connect("api")
        return self._client

    def files(self) -> list[SuppFile]:
        """Every candidate supplementary file, unfiltered by readability."""
        if self._files is None:
            self._files = self._resolve()
        return self._files

    def _resolve(self) -> list[SuppFile]:
        sq = self.client
        if self.accession.startswith("GSM"):
            # a GSM lists only its own files; a series _RAW.tar is series scope
            s = sq.fetch_geo_sample_detailed_metadata(self.accession).sample
            self._samples = [s]
            return [
                SuppFile(u, classify(u), self.accession, s.platform_ref)
                for u in (s.supplementary_data or [])
            ]

        out: list[SuppFile] = []
        samples = list(sq.fetch_samples(self.accession))
        self._samples = samples
        self._n_samples = len(samples)
        for s in samples:
            out += [
                SuppFile(u, classify(u), s.accession, s.platform_ref)
                for u in (s.supplementary_data or [])
            ]

        # a mixed series carries its bulk matrix here and single-cell ones per sample
        meta = sq.fetch_project_metadata(self.accession)
        seen = {f.url for f in out}
        out += [
            SuppFile(u, classify(u), None, None)
            for u, _ in (meta.supplementary_data or [])
            if u not in seen
        ]

        return out

    def units(self, *, preferred_only: bool = True) -> list[Unit]:
        """
        Readable matrix units, preferred per sample by default.

        preferred_only=False returns alternates such as 10x h5 plus mtx triplet.
        """
        if self._units is None:
            self._units = group(
                [f for f in self.files() if f.role != Role.Skip],
                self.accession,
                self.assay,
            )
        if preferred_only:
            return [u for u in self._units if u.preferred]
        return self._units

    def manifest(self, *, preferred_only: bool = False) -> pd.DataFrame:
        """DataFrame of readable units and backing files, before download."""
        return pd.DataFrame(
            [
                {
                    "unit": u.label,
                    "sample": u.sample,
                    "platform": u.platform,
                    "format": u.fmt,
                    "preferred": u.preferred,
                    "has_metadata": u.has_metadata,
                    "n_files": len(u.files),
                    "files": ", ".join(f.name for f in u.files),
                    "metadata_files": ", ".join(f.name for f in u.metadata_files),
                }
                for u in self.units(preferred_only=preferred_only)
            ]
        )

    def _select(self, sample: str | None) -> list[Unit]:
        if sample is None:
            return self.units()
        key = sample.strip()
        # exact unit labels have selection priority within a sample
        want = key.upper()
        exact = next(
            (u for u in self.units(preferred_only=False) if u.label.upper() == want),
            None,
        )
        if exact is not None:
            return [exact]
        hits = [u for u in self.units() if (u.sample or "").upper() == want]
        if not hits:
            msg = f"no unit for {sample!r}; see .manifest()"
            raise KeyError(msg)
        return hits

    def _one(self, sample: str | None) -> Unit:
        """Return the single selected unit, or raise naming how to disambiguate."""
        units = self._select(sample)
        if len(units) > 1:
            msg = (
                f"{self.accession} has {len(units)} units; pass sample= or use "
                f".matrices(). See .manifest()."
            )
            raise ValueError(msg)
        return units[0]

    def raw(
        self,
        sample: str | None = None,
        *,
        refresh: bool = False,
        progress: bool | None = None,
    ) -> list[Path]:
        """Download the files backing the selected units and return their paths."""
        return self._fetch(
            self._urls(self._select(sample)), refresh=refresh, progress=progress
        )

    @staticmethod
    def _urls(units: list[Unit]) -> list[str]:
        return sorted({u for unit in units for u in unit.urls})

    def _path_for(self, url: str) -> Path:
        return self._cache / url.rsplit("/", 1)[-1]

    def _fetch(
        self, urls: list[str], *, refresh: bool = False, progress: bool | None = None
    ) -> list[Path]:
        self._cache.mkdir(parents=True, exist_ok=True)
        want = {u: self._path_for(u) for u in urls}
        if refresh:
            for p in want.values():
                p.unlink(missing_ok=True)
        missing = [u for u, p in want.items() if not p.exists()]
        if missing:
            logger.info("downloading %d file(s) to %s", len(missing), self._cache)
            if not counts_ftp.ftp_unavailable() and len(missing) > 1:
                with ThreadPoolExecutor(min(4, len(missing))) as pool:
                    got = list(
                        pool.map(lambda u: counts_ftp.fetch(u, want[u]), missing)
                    )
                missing = [u for u, ok in zip(missing, got, strict=True) if not ok]
            else:
                missing = [u for u in missing if not counts_ftp.fetch(u, want[u])]
        if missing:
            # large chunks cap loop count for large GEO payloads
            # NCBI throttles high connection fanout; HTTPS workers are capped at 8
            self.client.download_files(
                missing,
                self._cache,
                num_workers=min(8, len(missing)),
                chunk_size=1 << 20,
                with_pbar=self.progress if progress is None else progress,
            )

        for url, path in want.items():
            check_hdf5_complete(path, url)
        return list(want.values())

    def matrices(
        self, sample: str | None = None, *, progress: bool | None = None
    ) -> dict[str, CountMatrix]:
        """Every selected unit read into a CountMatrix, keyed by unit label."""
        units = self._select(sample)
        show = self.progress if progress is None else progress
        # download_files parallelizes only within a single call.
        if len(units) > 1:
            self._fetch(self._urls(units), progress=show)

        # tqdm.auto probes ipywidgets at import time and warns in notebooks.
        from tqdm.auto import tqdm  # noqa: PLC0415

        out: dict[str, CountMatrix] = {}
        for unit in tqdm(
            units,
            desc="reading",
            unit="unit",
            disable=None if show and len(units) > 1 else True,
        ):
            try:
                out[unit.label] = self._read(unit)
            except Exception as e:
                logger.warning("could not read %s: %s", unit.label, e)
        return out

    def matrix(
        self, sample: str | None = None, *, progress: bool | None = None
    ) -> CountMatrix:
        """Read the single selected unit; raises when the selection is ambiguous."""
        unit = self._one(sample)
        self._fetch(unit.urls, progress=progress)
        return self._read(unit)

    def anndata(self, sample: str | None = None, *, concat: bool = True) -> Any:
        """
        Read selected units as AnnData.

        Multiple units concatenate on shared features with a sample column.
        concat=False raises on multiple units.
        """
        mats = self.matrices(sample)
        if not mats:
            msg = f"nothing readable in {self.accession}; see .manifest()"
            raise ValueError(msg)
        if len(mats) == 1:
            return next(iter(mats.values())).to_anndata()
        if not concat:
            msg = f"{len(mats)} units; pass sample= or concat=True"
            raise ValueError(msg)
        return bind_counts(mats)

    def native(self, sample: str | None = None) -> Any:
        """Return a file-native object when the format has one, else CountMatrix."""
        unit = self._one(sample)
        if unit.fmt == "h5ad":
            return read_h5ad(self._fetch(unit.urls)[0])
        return self._read(unit)

    # 10x and h5ad containers imply per-cell measurements.
    _SC_FMTS = frozenset({"10x_mtx", "10x_h5", "h5ad"})

    def _read(self, unit: Unit) -> CountMatrix:
        if unit.fmt == "tar":
            return self._read(self._expand_tar(unit))

        self._fetch(unit.urls)
        # Preserve fetch order when assigning paths to URLs.
        by_role: dict[Role, Path] = {}
        for f in unit.files:
            by_role.setdefault(f.role, self._path_for(f.url))

        if unit.fmt == "10x_mtx":
            x, obs, var = read_10x_mtx(
                by_role[Role.Mtx],
                by_role[Role.Barcodes],
                by_role[Role.Features],
                feature_type=self.feature_type,
            )
        elif unit.fmt == "10x_h5":
            x, obs, var = read_10x_h5(by_role[Role.H5], feature_type=self.feature_type)
        elif unit.fmt == "h5ad":
            a = read_h5ad(by_role[Role.H5ad])
            x, obs, var = a.X, a.obs, a.var
        elif unit.fmt == "rds":
            x, obs, var = read_rds(by_role[Role.Rds], assay=self.assay)
        elif unit.fmt == "table":
            x, obs, var = read_table(by_role[Role.Table])
        else:
            msg = f"{unit.label}: no reader for format {unit.fmt!r}"
            raise ValueError(msg)

        obs = self._merge_metadata(unit, obs)
        if self.sample_metadata:
            obs = self._attach_sample_metadata(unit, obs)
        kind, ev = (
            ("single_cell", [f"{unit.fmt} file"])
            if unit.fmt in self._SC_FMTS
            else infer_kind(obs, self._n_samples)
        )
        return CountMatrix(
            X=x,
            obs=obs,
            var=var,
            kind=kind,
            fmt=unit.fmt,
            accession=unit.sample or self.accession,
            source=", ".join(sorted(f.name for f in unit.files)),
            evidence=ev,
            metadata_fields=describe_metadata([str(c) for c in obs.columns]),
        )

    def samples(
        self, *, min_cell_count: int | None = 1, **filters: Any
    ) -> pd.DataFrame:
        """
        Return samples with readable units, after harmonised cohort filtering.

        Requires a GSE. `min_cell_count` drops samples without recorded counts
        unless None.

        Args:
            min_cell_count: Smallest cell count to keep. None keeps everything.
            **filters: Cohort filters, such as tissue="liver".

        Returns:
            Matching samples, most cells first, with `unit` and `format`.

        """
        if not self.accession.startswith("GSE"):
            msg = f"{self.accession} is a single sample; give a GSE to select within it"
            raise ValueError(msg)
        rows = self.client.sample_search(
            study_accession=self.accession, min_cell_count=min_cell_count, **filters
        ).to_df()
        if rows.empty and min_cell_count is not None:
            # bulk samples record no cell count, so the single-cell default drops them
            rows = self.client.sample_search(
                study_accession=self.accession, min_cell_count=None, **filters
            ).to_df()
            if not rows.empty:
                logger.info(
                    "no sample in %s records a cell count; ignoring min_cell_count=%s",
                    self.accession,
                    min_cell_count,
                )
        if rows.empty:
            return rows

        units = {u.sample: u for u in self.units() if u.sample}
        out = rows[rows["sample"].isin(units)].copy()
        if out.empty:
            logger.warning(
                "%d sample(s) matched the filters, but none ships a counts file; "
                "see .manifest()",
                len(rows),
            )
            return out
        out["unit"] = [units[s].label for s in out["sample"]]
        out["format"] = [units[s].fmt for s in out["sample"]]
        if "cells" in out.columns:
            out = out.sort_values("cells", ascending=False, na_position="last")
        front = [c for c in ("sample", "unit", "format", "cells", "tissue") if c in out]
        return out[front + [c for c in out.columns if c not in front]]

    @property
    def design(self) -> pd.DataFrame:
        """Sample-level characteristics fetched while resolving files."""
        if self._design is None:
            self.files()
            self._design = sample_frame(self._samples)
        return self._design

    def _attach_sample_metadata(self, unit: Unit, obs: pd.DataFrame) -> pd.DataFrame:
        """
        Carry study-level sample characteristics onto observations.

        Single-cell rows get sample values broadcast. Bulk rows join by sample
        index. Per-cell obs columns win over sample-level columns.
        """
        design = self.design
        if design.empty:
            return obs

        if unit.sample and unit.sample in design.index:
            for column, value in design.loc[unit.sample].items():
                if column not in obs.columns:
                    obs[column] = value
            obs["sample"] = unit.sample
            return obs

        shared = obs.index.intersection(design.index)
        if shared.empty:
            return obs
        new = [c for c in design.columns if c not in obs.columns]
        logger.info(
            "%s: attached %d sample column(s) to %d/%d observations",
            unit.label,
            len(new),
            len(shared),
            len(obs),
        )
        return obs.join(design[new], how="left")

    def _merge_metadata(self, unit: Unit, obs: pd.DataFrame) -> pd.DataFrame:
        """
        Join sidecar annotation onto obs by cell label.

        Only rows already in obs are kept; outer joins would invent cells.
        """
        for f in unit.metadata_files:
            path = self._path_for(f.url)
            try:
                meta = self._meta_cache.get(path)
                if meta is None:
                    meta = self._meta_cache[path] = read_metadata(path)
            except Exception as e:
                logger.warning("could not read metadata %s: %s", f.name, e)
                continue
            overlap = obs.index.intersection(meta.index)
            if overlap.empty:
                logger.info(
                    "%s: %s shares no cell labels with the matrix, skipping",
                    unit.label,
                    f.name,
                )
                continue
            new = [c for c in meta.columns if c not in obs.columns]
            obs = obs.join(meta[new], how="left")
            logger.info(
                "%s: merged %d metadata column(s) from %s covering %d/%d cells",
                unit.label,
                len(new),
                f.name,
                len(overlap),
                len(obs),
            )
        return obs

    def _expand_tar(self, unit: Unit) -> Unit:
        """Extract a tar's matrix members and regroup them as if they were files."""
        tar_path = self._fetch(unit.urls)[0]
        dest = self._cache / f"{tar_path.name}.extracted"
        if not dest.exists():
            tmp = Path(tempfile.mkdtemp(dir=self._cache))
            # r|* streams; r:* inflates a .tar.gz twice, once to enumerate
            with tarfile.open(tar_path, mode="r|*") as tf:
                for m in tf:
                    if m.isfile() and classify(m.name) is not Role.Skip:
                        tf.extract(m, tmp, filter="data")
            tmp.rename(dest)

        files = []
        for p in sorted(dest.rglob("*")):
            if not p.is_file():
                continue
            role = classify(p.name)
            if role is Role.Skip:
                continue
            files.append(
                SuppFile(
                    url=p.as_uri(),
                    role=role,
                    sample=gsm_in(p.name),
                    member=str(p.relative_to(dest)),
                )
            )
        units = group(files, self.accession, self.assay)
        if not units:
            msg = f"{tar_path.name}: no readable matrix inside"
            raise ValueError(msg)
        units = [u for u in units if u.preferred] or units
        if len(units) > 1:
            logger.info(
                "%s holds %d units; reading the first (%s). Extracted to %s",
                tar_path.name,
                len(units),
                units[0].label,
                dest,
            )
        return units[0]


# name parity with the R client; .matrix() starts fetching
SeqoutListCounts = SeqoutCounts
seqout_counts = SeqoutCounts
seqout_list_counts = SeqoutCounts


# Store large zero-padded unions sparsely to bound memory use.
_DENSE_ELEMENT_LIMIT = 50_000_000


def _densify_would_blow_up(adatas: list[Any], n_features: int, n_cells: int) -> bool:
    """Whether an outer join has to go sparse to fit."""
    if all(hasattr(a.X, "nnz") for a in adatas):
        return False
    if all(a.n_vars == n_features for a in adatas):
        return False
    return n_features * n_cells > _DENSE_ELEMENT_LIMIT


def _check_features(
    keys: list[str],
    features: list[set[str]],
    shared: set[str],
    *,
    strict: bool,
) -> None:
    """Warn, or raise, when an inner join would drop features."""
    dropped = {k: len(f) - len(shared) for k, f in zip(keys, features, strict=True)}
    if not any(dropped.values()):
        return
    worst = sorted(dropped.items(), key=lambda kv: -kv[1])[:3]
    detail = ", ".join(f"{k} loses {n}" for k, n in worst if n)
    msg = (
        f"the {len(keys)} matrices do not share a feature space: "
        f"{len(shared)} features are common to all, and binding on them drops "
        f"up to {max(dropped.values())} per matrix ({detail})"
    )
    if strict:
        raise ValueError(msg)
    logger.warning("%s. Pass strict=True to make this an error.", msg)


def bind_counts(
    matrices: dict[str, CountMatrix] | list[CountMatrix],
    labels: list[str] | None = None,
    max_cells: int | None = None,
    seed: int | None = None,
    *,
    strict: bool = False,
    join: Literal["inner", "outer"] = "inner",
) -> Any:
    """
    Bind counts matrices across samples.

    join="inner" keeps shared genes and warns when features are dropped.
    Per-sample peak calls can have different feature sets. strict=True raises
    on feature loss.

    join="outer" keeps the union and fills absent genes with zero. A zero there
    means "not in this matrix", not "measured as zero".

    Dense and sparse inputs may be mixed. Dense outer joins exceeding 5e7
    elements use sparse storage to bound memory when features barely overlap.

    Args:
        matrices: CountMatrix objects, as SeqoutListCounts.matrices() returns.
        labels: One name per matrix, used for the `sample` column and the cell
            name suffix. Defaults to the dict keys.
        max_cells: Cap on cells kept per matrix, sampled at random. None keeps
            all; pass seed for a reproducible draw.
        seed: Seed for that draw.
        strict: Raise rather than warn when the feature sets differ. Ignored
            for join="outer", which drops nothing.
        join: "inner" for the shared genes, "outer" for the union zero-filled.

    Returns:
        One AnnData, cells by genes.

    """
    if join not in ("inner", "outer"):
        msg = f"join must be 'inner' or 'outer', not {join!r}"
        raise ValueError(msg)
    items = (
        list(matrices.items())
        if isinstance(matrices, dict)
        else [(str(i), m) for i, m in enumerate(matrices)]
    )
    if not items:
        msg = "matrices is empty"
        raise ValueError(msg)
    keys = [str(k) for k, _ in items] if labels is None else [str(x) for x in labels]
    if len(keys) != len(items):
        msg = f"labels has {len(keys)} entries, matrices has {len(items)}"
        raise ValueError(msg)

    ad = _require("anndata")
    rng = np.random.default_rng(seed)
    adatas = []
    for _, m in items:
        a = m.to_anndata() if isinstance(m, CountMatrix) else m
        if max_cells is not None and a.n_obs > max_cells:
            a = a[np.sort(rng.choice(a.n_obs, max_cells, replace=False))].copy()
        adatas.append(a)

    # to_anndata() has normalised both input shapes, so var_names is the one
    # place the feature sets live from here on
    features = [set(a.var_names) for a in adatas]
    if join == "inner":
        shared = features[0].intersection(*features[1:])
        if not shared:
            msg = (
                f"the {len(items)} matrices share no features; "
                f'pass join="outer" to keep the union instead'
            )
            raise ValueError(msg)
        _check_features(keys, features, shared, strict=strict)
    else:
        n_features = len(set().union(*features))
        n_cells = sum(a.n_obs for a in adatas)
        if _densify_would_blow_up(adatas, n_features, n_cells):
            sparse = _require("scipy.sparse")
            logger.info(
                "binding %d features x %d cells as a sparse matrix; dense would "
                "allocate %d elements, nearly all of them zero",
                n_features,
                n_cells,
                n_features * n_cells,
            )
            # Copy before conversion to preserve the caller's AnnData.
            adatas = [
                a
                if hasattr(a.X, "nnz")
                else ad.AnnData(X=sparse.csr_matrix(a.X), obs=a.obs, var=a.var)
                for a in adatas
            ]

    return ad.concat(
        adatas,
        keys=keys,
        join=join,
        fill_value=0,
        label="sample",
        index_unique="-",
    )
