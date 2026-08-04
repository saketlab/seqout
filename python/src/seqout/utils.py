import os
from collections.abc import Iterable
from typing import Any, Literal
from urllib.parse import urlparse

import pandas as pd

from seqout.constants import COUNTRY_CODE_MAP, COUNTRY_NAME_MAP
from seqout.models.api_models import StudyRunsResult, StudyRunsResults

StudyRunDownloadMode = Literal["fastq", "sra", "sra_lite", "s3", "gcs"]


def _validate_study_runs_data(
    runs: StudyRunsResults, mode: StudyRunDownloadMode
) -> None:
    if mode == "fastq" and not all(r.fastq_ftp is not None for r in runs):
        missing = [r.run_accession for r in runs if r.fastq_ftp is None]
        raise ValueError(f"missing fastq ftp url for runs: {missing}")
    if mode == "sra" and not all(r.sra_ftp is not None for r in runs):
        missing = [r.run_accession for r in runs if r.sra_ftp is None]
        raise ValueError(f"missing sra ftp url for runs: {missing}")
    if mode == "sra_lite" and not all(r.ncbi_sra_lite_url is not None for r in runs):
        missing = [r.run_accession for r in runs if r.ncbi_sra_lite_url is None]
        raise ValueError(f"missing sra lite url for runs: {missing}")
    if mode == "s3" and not all(r.ncbi_sra_lite_s3_url is not None for r in runs):
        missing = [r.run_accession for r in runs if r.ncbi_sra_lite_s3_url is None]
        raise ValueError(f"missing ncbi sra s3 url for runs: {missing}")
    if mode == "gcs" and not all(r.ncbi_sra_lite_gs_url is not None for r in runs):
        missing = [r.run_accession for r in runs if r.ncbi_sra_lite_gs_url is None]
        raise ValueError(f"missing ncbi sra gcs url for runs: {missing}")


def _extract_download_info_for_study_run(
    run: StudyRunsResult, mode: StudyRunDownloadMode
) -> tuple[list[str], list[str], list[str]]:
    if mode == "fastq":
        url_text = run.fastq_ftp
    elif mode == "sra":
        url_text = run.sra_ftp
    elif mode == "sra_lite":
        url_text = run.ncbi_sra_lite_url
    elif mode == "s3":
        url_text = run.ncbi_sra_lite_s3_url
    elif mode == "gcs":
        url_text = run.ncbi_sra_lite_gs_url

    if mode == "fastq":
        bytes_text = run.fastq_bytes
        md5_checksum_text = run.fastq_md5
    else:
        bytes_text = run.sra_bytes
        md5_checksum_text = run.sra_md5

    return (url_text.split(";"), bytes_text.split(";"), md5_checksum_text.split(";"))


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
    """Return the ISO 3166-1 alpha-2 code for a country name, or None."""
    return COUNTRY_NAME_MAP.get(name)


def country_code_to_name(code: str) -> str | None:
    """Return the country name for an ISO 3166-1 alpha-2 code, or None."""
    return COUNTRY_CODE_MAP.get(code)


def _characteristics(channel: Any) -> dict[str, str]:
    """
    One channel's characteristics as a flat mapping.

    The API flattens them to a dict; the parquet backend returns GEO's raw
    list of {"@tag": ..., "#text": ...} entries.
    """
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
    Build a DataFrame of samples and their characteristics, indexed by accession.

    Characteristics are free-text key/value pairs chosen by the submitter, so
    the columns vary by study and are worth inspecting before being relied on.
    Works across backends and archives: GEO samples carry them per channel,
    ArrayExpress samples as flat attributes.

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
