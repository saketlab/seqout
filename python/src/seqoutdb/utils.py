import hashlib
import os
import queue
import time
from pathlib import Path
from typing import Literal, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from seqoutdb import StudyRunsResult, StudyRunsResults
from seqoutdb.constants import COUNTRY_CODE_MAP, COUNTRY_NAME_MAP

# accepts the class itself and not an instance of it
T = TypeVar("T", bound=BaseModel)
StudyRunDownloadMode = Literal["fastq", "sra", "sra_lite", "s3", "gcs"]


def _send_get_req(
    client: httpx.Client,
    url: str,
    response_model: type[T],
    max_attempts: int,
    backoff_factor: float,
    timeout: int,
    params: BaseModel | None = None,
) -> T:
    for attempt in range(max_attempts):
        try:
            req = client.build_request(
                "GET",
                url,
                params=None
                if params is None
                else params.model_dump(exclude_none=True, by_alias=True),
                timeout=timeout,
            )

            response = client.send(req)
            response.raise_for_status()
            return response_model.model_validate(response.json())
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status == 422:
                raise ValueError(f"invalid parameters: {e.response.text}") from e
            if status == 429:
                raise RuntimeError("rate limit exceeded") from e
            if status >= 500:
                raise RuntimeError(f"internal server error ({status})") from e
            raise
        except httpx.TimeoutException as e:
            if attempt == max_attempts - 1:
                raise TimeoutError(f"request timed out: {e}") from e

            time.sleep(backoff_factor**attempt)
        except httpx.NetworkError as e:
            raise ConnectionError(f"could not connect to seqout: {e}") from e
        except ValidationError as e:
            raise ValueError(f"unexpected response format: {e}") from e

    # just to pleasure the lsp
    return response_model()


def _download_file(
    url: str,
    dest: Path,
    chunk_size: int,
    queue: queue.Queue[tuple[str, str, int | None]] | None = None,
):
    with httpx.stream("GET", url, follow_redirects=True) as response:
        response.raise_for_status()
        dest.parent.mkdir(exist_ok=True, parents=True)

        total = int(response.headers.get("content-length", 0))
        if queue:
            queue.put((url, "total", total))

        with open(dest, "wb") as f:
            for chunk in response.iter_bytes(chunk_size):
                f.write(chunk)
                if queue:
                    queue.put((url, "update", len(chunk)))

    if queue:
        queue.put((url, "done", None))


def _verify_file(
    path: Path, expected_bytes: int, expected_md5: str
) -> tuple[str, bool, str]:
    if not path.exists():
        return path.name, False, "file not found"

    actual_size = path.stat().st_size
    if actual_size != expected_bytes:
        return (
            path.name,
            False,
            f"size mismatch: got {actual_size} bytes, expected {expected_bytes} bytes",
        )

    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(
            lambda: f.read(64 * 1024), b""
        ):  # 64 KiB chunks until it reaches EOF
            h.update(chunk)

    actual_md5 = h.digest()
    if actual_md5 != expected_md5:
        return (
            path.name,
            False,
            f"checksum mismatch: got {actual_md5}, expected {expected_md5}",
        )

    return path.name, True, "ok"


def _validate_study_runs_data(runs: StudyRunsResults, mode: StudyRunDownloadMode):
    if mode == "fastq" and not all(r.fastq_ftp is not None for r in runs):
        missing = [r.run_accession for r in runs if r.fastq_ftp is None]
        raise ValueError(f"missing fastq ftp url for runs: {missing}")
    elif mode == "sra" and not all(r.sra_ftp is not None for r in runs):
        missing = [r.run_accession for r in runs if r.sra_ftp is None]
        raise ValueError(f"missing sra ftp url for runs: {missing}")
    elif mode == "sra_lite" and not all(r.ncbi_sra_lite_url is not None for r in runs):
        missing = [r.run_accession for r in runs if r.ncbi_sra_lite_url is None]
        raise ValueError(f"missing sra lite url for runs: {missing}")
    elif mode == "s3" and not all(r.ncbi_sra_lite_s3_url is not None for r in runs):
        missing = [r.run_accession for r in runs if r.ncbi_sra_lite_s3_url is None]
        raise ValueError(f"missing ncbi sra s3 url for runs: {missing}")
    elif mode == "gcs" and not all(r.ncbi_sra_lite_gs_url is not None for r in runs):
        missing = [r.run_accession for r in runs if r.ncbi_sra_lite_gs_url is None]
        raise ValueError(f"missing ncbi sra gcs url for runs: {missing}")


def _extract_download_info_for_study_run(
    run: StudyRunsResult, mode: StudyRunDownloadMode
) -> tuple[list[str], list[str], list[str]]:
    if mode == "fastq":
        assert run.fastq_ftp
        url_text = run.fastq_ftp
    elif mode == "sra":
        assert run.sra_ftp
        url_text = run.sra_ftp
    elif mode == "sra_lite":
        assert run.ncbi_sra_lite_url
        url_text = run.ncbi_sra_lite_url
    elif mode == "s3":
        assert run.ncbi_sra_lite_s3_url
        url_text = run.ncbi_sra_lite_s3_url
    elif mode == "gcs":
        assert run.ncbi_sra_lite_gs_url
        url_text = run.ncbi_sra_lite_gs_url

    if mode == "fastq":
        assert run.fastq_bytes
        bytes_text = run.fastq_bytes
        assert run.fastq_md5
        md5_checksum_text = run.fastq_md5
    else:
        assert run.sra_bytes
        bytes_text = run.sra_bytes
        assert run.sra_md5
        md5_checksum_text = run.sra_md5

    return (url_text.split(";"), bytes_text.split(";"), md5_checksum_text.split(";"))


def _normalize_num_workers(n_workers: int | None) -> int:
    cpu_count = os.cpu_count()
    if cpu_count is None:
        cpu_count = 1

    if n_workers is None:
        n_workers = max(1, cpu_count - 2)
    else:
        if n_workers >= cpu_count:
            raise ValueError(
                "num of workers must be less than total number of CPUs in the system"
            )

    return n_workers


def _normalize_url(url: str) -> str:
    # use https over ftp
    url = url.replace("ftp://", "https://")
    if not url.startswith("https://"):
        url = "https://" + url
    return url


def country_name_to_code(name: str) -> str | None:
    return COUNTRY_NAME_MAP.get(name)


def country_code_to_name(code: str) -> str | None:
    return COUNTRY_CODE_MAP.get(code)
