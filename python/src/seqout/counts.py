"""
Read GEO accession as counts matrix.
"""

from __future__ import annotations

import logging
import tarfile
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Self

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

logger = logging.getLogger(__name__)


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
        feature_type: 10x feature class to keep. "Gene Expression" drops the
            ATAC/antibody rows of multiome and CITE-seq matrices; None keeps
            everything.

    """

    def __init__(
        self,
        accession: str | None = None,
        *,
        gse: str | None = None,
        gsm: str | None = None,
        client: Any = None,
        cache_dir: Path | str | None = None,
        feature_type: str | None = "Gene Expression",
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
                "fetch_geo_sample_detailed_metadata. Pass an API client "
                "(connect('api')) or omit client= to open one."
            )
            raise TypeError(msg)

        self.feature_type = feature_type
        self._client = client
        self._owns_client = client is None
        self._cache = Path(
            cache_dir or Path.home() / ".cache" / "seqout" / "counts" / self.accession
        )
        self._n_samples = 0  # GSMs in the series, an input to bulk-vs-sc
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
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None

    @property
    def client(self) -> Any:
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
            # a series _RAW.tar belongs to the series, not to this sample
            s = sq.fetch_geo_sample_detailed_metadata(self.accession).sample
            return [
                SuppFile(u, classify(u), self.accession, s.platform_ref)
                for u in (s.supplementary_data or [])
            ]

        out: list[SuppFile] = []
        samples = list(sq.fetch_samples(self.accession))
        self._n_samples = len(samples)
        for s in samples:
            out += [
                SuppFile(u, classify(u), s.accession, s.platform_ref)
                for u in (s.supplementary_data or [])
            ]

        # Series-level files (a bulk count table, a _RAW.tar) are always listed:
        # a mixed series can carry its bulk matrix here while its single-cell
        # samples carry their own. Never auto-selected; see _prefer.
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
        Readable units; 

        A sample often ships the same counts twice (a 10x h5 and its mtx
        triplet). By default only the preferred one per sample is returned;
        preferred_only=False shows every unit so nothing is silently hidden.
        """
        if self._units is None:
            self._units = group(
                [f for f in self.files() if f.role != Role.Skip], self.accession
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
        # a specific label beats the preferred unit of the same sample
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

    def raw(self, sample: str | None = None, *, refresh: bool = False) -> list[Path]:
        """Download the files backing the selected units and return their paths."""
        return self._fetch(self._urls(self._select(sample)), refresh=refresh)

    @staticmethod
    def _urls(units: list[Unit]) -> list[str]:
        return sorted({u for unit in units for u in unit.urls})

    def _path_for(self, url: str) -> Path:
        return self._cache / url.rsplit("/", 1)[-1]

    def _fetch(self, urls: list[str], *, refresh: bool = False) -> list[Path]:
        self._cache.mkdir(parents=True, exist_ok=True)
        want = {u: self._path_for(u) for u in urls}
        if refresh:
            for p in want.values():
                p.unlink(missing_ok=True)
        missing = [u for u, p in want.items() if not p.exists()]
        if missing:
            logger.info("downloading %d file(s) to %s", len(missing), self._cache)
            # bounded: serial FTP would be slower than the HTTPS path it replaces
            if not counts_ftp.ftp_unavailable() and len(missing) > 1:
                with ThreadPoolExecutor(min(4, len(missing))) as pool:
                    got = list(
                        pool.map(lambda u: counts_ftp.fetch(u, want[u]), missing)
                    )
                missing = [u for u, ok in zip(missing, got, strict=True) if not ok]
            else:
                missing = [u for u in missing if not counts_ftp.fetch(u, want[u])]
        if missing:
            # 1 MiB chunks: the client default of 2 KiB means half a million loop
            # iterations per GB, and these files run to tens of GB
            # concurrency is a property of the remote host, not of local cores:
            # the client default is cpu_count-2, which is 126 here and both
            # overruns the connection pool and provokes NCBI throttling
            self.client.download_files(
                missing,
                self._cache,
                num_workers=min(8, len(missing)),
                chunk_size=1 << 20,
                with_pbar=True,
            )

        for url, path in want.items():
            check_hdf5_complete(path, url)
        return list(want.values())

    def matrices(self, sample: str | None = None) -> dict[str, CountMatrix]:
        """Every selected unit read into a CountMatrix, keyed by unit label."""
        units = self._select(sample)
        # download_files threads within one call but not across them, so
        # per-unit fetching would run a 20-sample series one stream at a time
        if len(units) > 1:
            self._fetch(self._urls(units))

        out: dict[str, CountMatrix] = {}
        for unit in units:
            try:
                out[unit.label] = self._read(unit)
            except Exception as e:
                logger.warning("could not read %s: %s", unit.label, e)
        return out

    def matrix(self, sample: str | None = None) -> CountMatrix:
        """Read the single selected unit; raises when the selection is ambiguous."""
        return self._read(self._one(sample))

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
        adatas = {k: m.to_anndata() for k, m in mats.items()}
        if len(adatas) == 1:
            return next(iter(adatas.values()))
        if not concat:
            msg = f"{len(adatas)} units; pass sample= or concat=True"
            raise ValueError(msg)
        ad = _require("anndata")
        return ad.concat(adatas, join="inner", label="sample", index_unique="-")

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

    # formats whose container already tells us these are per-cell measurements
    _SC_FMTS = frozenset({"10x_mtx", "10x_h5", "h5ad"})

    def _read(self, unit: Unit) -> CountMatrix:
        if unit.fmt == "tar":
            return self._read(self._expand_tar(unit))

        self._fetch(unit.urls)
        # derive each path from its own URL; zipping against the fetch result
        # pairs resolution order against sorted-URL order, which agree by luck
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
            x, obs, var = read_rds(by_role[Role.Rds])
        elif unit.fmt == "table":
            x, obs, var = read_table(by_role[Role.Table])
        else:
            msg = f"{unit.label}: no reader for format {unit.fmt!r}"
            raise ValueError(msg)

        obs = self._merge_metadata(unit, obs)
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
                meta = read_metadata(path)
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
        units = group(files, self.accession)
        if not units:
            msg = f"{tar_path.name}: no readable matrix inside"
            raise ValueError(msg)
        if len(units) > 1:
            logger.info(
                "%s holds %d units; reading the first (%s). Extracted to %s",
                tar_path.name,
                len(units),
                units[0].label,
                dest,
            )
        return units[0]
