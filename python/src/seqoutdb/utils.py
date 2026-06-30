import os
from typing import Literal
from urllib.parse import urlparse

from seqoutdb.constants import COUNTRY_CODE_MAP, COUNTRY_NAME_MAP
from seqoutdb.models.api_models import StudyRunsResult, StudyRunsResults

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
    return COUNTRY_NAME_MAP.get(name)


def country_code_to_name(code: str) -> str | None:
    return COUNTRY_CODE_MAP.get(code)
