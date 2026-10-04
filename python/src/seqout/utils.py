import logging
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import pandas as pd

from seqout.constants import COUNTRY_CODE_MAP, COUNTRY_NAME_MAP
from seqout.models.api_models import RunFile, StudyRunsResult

logger = logging.getLogger(__name__)

StudyRunDownloadMode = Literal["fastq", "sra", "sra_lite"]


def _run_files_to_fetch(
    runs: Iterable[StudyRunsResult], mode: StudyRunDownloadMode | None
) -> list[RunFile]:
    """Pick each run's files in `mode`; skip runs not served so, fail if all are."""
    per_run = [(r.run_accession, r.files(mode)) for r in runs]
    files = [f for _, fs in per_run for f in fs]
    if not files:
        msg = f"No run is served as {mode or 'any downloadable copy'}."
        raise ValueError(msg)
    missing = [acc for acc, fs in per_run if not fs]
    if missing:
        logger.warning(
            "%d of %d runs have no %s copy and are skipped: %s",
            len(missing),
            len(per_run),
            mode or "downloadable",
            ", ".join(missing),
        )
    return files


def _url_destinations(
    urls: list[str], out_dir: Path, names: list[str] | None = None
) -> dict[str, Path]:
    """Map each normalized URL to its path in out_dir, named by `names` if given."""
    dest: dict[str, Path] = {}
    for url, name in zip(urls, names or [None] * len(urls), strict=True):
        normalized = _normalize_url(url)
        dest[normalized] = out_dir / (name or normalized.split("/")[-1])
    return dest


def _normalize_num_workers(num_workers: int | None) -> int:
    if num_workers is None:
        cpu_count = os.cpu_count() or 1
        num_workers = max(1, cpu_count - 2)

    return num_workers


def _normalize_url(url: str) -> str:
    url = url.strip()
    parsed = urlparse(url)

    if parsed.scheme == "ftp":
        url = url.replace("ftp://", "https://", 1)
    elif parsed.scheme == "":
        url = "https://" + url

    return url


def country_name_to_code(name: str) -> str | None:
    """Return the ISO 3166-1 alpha-3 code for a country name, or None."""
    return COUNTRY_NAME_MAP.get(name)


def country_code_to_name(code: str) -> str | None:
    """Return the country name for an ISO 3166-1 alpha-3 code, or None."""
    return COUNTRY_CODE_MAP.get(code)


def _characteristics(channel: Any) -> dict[str, str]:
    """One channel's characteristics as a flat mapping across backends."""
    raw = getattr(channel, "characteristics", None)
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    out: dict[str, str] = {}
    for item in raw or []:
        if isinstance(item, dict):
            tag, text = item.get("@tag"), item.get("#text")
            if tag is not None:
                out[str(tag)] = str(text)
    return out


# ArrayExpress exposes these as flat sample attributes
_AE_ATTRS = (
    "source_name",
    "organism",
    "organism_part",
    "cell_type",
    "disease",
    "library_strategy",
    "library_source",
    "library_selection",
)


def sample_frame(samples: Iterable[Any]) -> pd.DataFrame:
    """
    Build a sample-characteristics DataFrame indexed by accession.

    GEO carries attributes per channel. ArrayExpress carries them as flat sample
    attributes.

        design = sample_frame(sq.fetch_samples("GSE297547"))
        design.loc["GSM8994520", "tissue"]
    """
    rows = []
    for s in samples:
        row = {"sample": s.accession, "title": getattr(s, "title", None)}
        channels = getattr(s, "channels", None) or []
        for channel in channels:
            row.update(_characteristics(channel))
        if not channels:
            row.update(
                {a: v for a in _AE_ATTRS if (v := getattr(s, a, None)) is not None}
            )
        rows.append(row)
    frame = pd.DataFrame(rows)
    return frame.set_index("sample") if not frame.empty else frame
