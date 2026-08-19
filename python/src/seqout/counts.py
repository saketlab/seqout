"""
Read a GEO accession as a counts matrix.

    from seqout import seqout_counts

    c = seqout_counts(gsm="GSM8207499")
    c.manifest()      # what was found, before anything is downloaded
    m = c.matrix()
    a = c.anndata()

The constructor resolves supplementary files and groups them into readable
units; nothing is downloaded until you ask for raw(), matrix() or anndata().
GEO supplementary payloads run to tens of GB, so fetching in a constructor is
not a usable API.
"""

from __future__ import annotations

import logging
import tarfile
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Self

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
    Lazy reader for the counts matrices in a GEO series or sample.

    Args:
        accession: A GSE or GSM; equivalent to passing gse= or gsm=.
        gse: GEO series accession.
        gsm: GEO sample accession.
        client: An existing SeqoutAPIClient. One is opened on demand when
            omitted. The parquet backend is not supported yet; it has no
            fetch_geo_sample_detailed_metadata, and its sample model spells
            platform where the API model spells platform_ref.
        cache_dir: Where downloads land. Defaults to
            ~/.cache/seqout/counts/<accession>; files are reused across runs.
        assay: which assay to take when a sample, or an R object, carries
            several, as CITE-seq and multiome studies do. Defaults to "rna";
            "adt", "hto" and "atac" are recognised too. None takes whichever
            comes first. This also sets which rows of a combined 10x matrix are
            kept, so the two cannot disagree.
        feature_type: 10x feature class to keep, overriding the one implied by
            assay. Rarely needed; pass None to keep every row.
        progress: show download and read progress. Bars render as a widget in a
            notebook and as text in a terminal, and hide themselves when output
            is not a terminal. Pass False to silence them entirely.
        sample_metadata: attach the study's sample-level characteristics to obs,
            so a cell carries the donor, tissue and condition it came from
            alongside its own annotation. Pass False to keep obs as deposited.

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
                f"{type(client).__name__} cannot back SeqoutCounts: it has no "
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
        return f"SeqoutCounts({self.accession}, {n} unit(s))"

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        """Close the client, when this object opened one of its own."""
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
        Readable units, one matrix each.

        A sample often ships the same counts twice (a 10x h5 and its mtx
        triplet). By default only the preferred one per sample is returned;
        preferred_only=False shows every unit so nothing is silently hidden.
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
        """
        Show what would be read, and from which files. No download.

        Shows every unit by default, with preferred marking the one that
        matrix() picks for each sample.
        """
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
            # 1 MiB chunks cap the loop count for tens-of-GB GEO payloads.
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
        Read the selected units as AnnData.

        Multiple units are concatenated on an inner feature join with a sample
        column, which is what a whole-series read usually wants; concat=False
        raises instead so a silent join can't hide a mixed-platform series.
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
        """
        Return the file's own object, unconverted.

        Only .h5ad has one; it comes back as the AnnData on disk, metadata and
        embeddings intact. Every other format is normalised on read and falls
        back to matrix().
        """
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
        # fetch order and sorted-URL order agree only by luck
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
        Choose which samples of the series to read.

        Filters the study's samples through the harmonised cohort search and
        keeps the ones that have a readable unit. Use it on a series that mixes
        tissues or assays.

        Args:
            min_cell_count: Smallest cell count to keep. A sample with no
                recorded count goes too; None keeps everything.
            **filters: Cohort filters, such as tissue="liver". The study comes
                from this object.

        Returns:
            The matching samples, most cells first, with the `unit` and
            `format` that matrix() would read.

        """
        if not self.accession.startswith("GSE"):
            msg = f"{self.accession} is a single sample; give a GSE to select within it"
            raise ValueError(msg)
        rows = self.client.sample_search(
            study_accession=self.accession, min_cell_count=min_cell_count, **filters
        ).to_df()
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
        """
        Sample-level characteristics for the study, indexed by accession.

        Built from the sample records resolution already fetched, so reading it
        costs nothing extra.
        """
        if self._design is None:
            self.files()
            self._design = sample_frame(self._samples)
        return self._design

    def _attach_sample_metadata(self, unit: Unit, obs: pd.DataFrame) -> pd.DataFrame:
        """
        Carry the study's per-sample characteristics onto the observations.

        For single-cell data every row came from one sample, so its values are
        broadcast. For a bulk table the rows are samples themselves, so the
        design joins on the index instead. Columns already present in obs win,
        since annotation deposited per cell is more specific than per sample.
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
        Join any sidecar annotation onto obs, keyed by cell label.

        Only rows already in obs are kept: a series-level metadata file usually
        covers every sample, so an outer join would invent cells this unit does
        not contain.
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


seqout_counts = SeqoutCounts


def bind_counts(
    matrices: dict[str, CountMatrix] | list[CountMatrix],
    labels: list[str] | None = None,
    max_cells: int | None = None,
    seed: int | None = None,
) -> Any:
    """
    Bind counts matrices across samples, on the genes they share.

    Args:
        matrices: CountMatrix objects, as SeqoutCounts.matrices() returns.
        labels: One name per matrix, used for the `sample` column and the cell
            name suffix. Defaults to the dict keys.
        max_cells: Cap on cells kept per matrix, sampled at random. None keeps
            all; pass seed for a reproducible draw.
        seed: Seed for that draw.

    Returns:
        One AnnData, cells by genes.

    """
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

    features = [
        set(m.var.index if isinstance(m, CountMatrix) else m.var_names)
        for _, m in items
    ]
    if not features[0].intersection(*features[1:]):
        msg = f"the {len(items)} matrices share no features"
        raise ValueError(msg)

    ad = _require("anndata")
    rng = np.random.default_rng(seed)
    adatas = []
    for _, m in items:
        a = m.to_anndata() if isinstance(m, CountMatrix) else m
        if max_cells is not None and a.n_obs > max_cells:
            a = a[np.sort(rng.choice(a.n_obs, max_cells, replace=False))].copy()
        adatas.append(a)
    return ad.concat(adatas, keys=keys, join="inner", label="sample", index_unique="-")
