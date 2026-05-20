import os
import queue
import time
from concurrent.futures import Future
from pathlib import Path
from typing import Literal, TypeVar

import httpx
from pydantic import BaseModel, ValidationError
from tqdm import tqdm

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

    # hacky for python type system
    temp = response_model()
    return temp


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


def _run_parallel_downloads(
    futures: dict[Future, str],
    queue: queue.Queue[tuple[str, str, int | None]] | None,
    url_to_dest: dict[str, Path],
    url_to_bytes_and_checksum: dict[str, tuple[int, str]] | None = None,
) -> list[tuple[str, Exception]]:
    failed: list[tuple[str, Exception]] = []

    if queue is not None:
        pbars: dict[str, tqdm] = {}
        pending = len(futures)

        while pending > 0:
            try:
                url, kind, value = queue.get(timeout=0.5)
            except Exception:
                all_done = all(f.done() for f in futures)
                if all_done and queue.empty():
                    break
                continue

            if kind == "total":
                pbars[url] = tqdm(
                    total=value,
                    unit="B",
                    unit_scale=True,
                    unit_divisor=1024,
                    desc=url_to_dest[url].name,
                    dynamic_ncols=True,
                )
            elif kind == "update":
                if url in pbars:
                    pbars[url].update(value)
            elif kind == "done":
                if url in pbars:
                    pbars[url].close()
                pending -= 1

        for bar in pbars.values():
            if not bar.disable:
                bar.close()

    for future, url in futures.items():
        try:
            future.result()

            if url_to_bytes_and_checksum:
                dest_path = url_to_dest[url]
                expected_bytes, expected_checksum = url_to_bytes_and_checksum[url]
                actual_bytes = os.path.getsize(dest_path)

                if expected_bytes != actual_bytes:
                    failed.append(
                        (
                            url,
                            Exception(
                                f"download verification failed for {dest_path.name}: excepted {expected_bytes} bytes, got {actual_bytes} bytes"
                            ),
                        )
                    )

        except Exception as e:
            failed.append((url, e))

    return failed


def _validate_num_workers(n_workers: int | None) -> int:
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
