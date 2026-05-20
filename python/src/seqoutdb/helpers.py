import hashlib
import queue
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError
from tqdm import tqdm

# accepts the class itself and not an instance of it
T = TypeVar("T", bound=BaseModel)


def _send_req(
    client: httpx.Client,
    method: str,
    url: str,
    response_model: type[T],
    max_attempts: int,
    backoff_factor: float,
    timeout: int,
    params: BaseModel | None = None,
    body: dict | None = None,
) -> T:
    for attempt in range(max_attempts):
        try:
            params = (
                None
                if params is None
                else params.model_dump(exclude_none=True, by_alias=True)
            )

            req = client.build_request(
                method=method,
                url=url,
                params=params,
                json=body,
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
    if_exists_ttl: int | None = None,
):
    if dest.exists() and if_exists_ttl:
        now = datetime.now().second
        diff = now - int(dest.stat().st_ctime)
        if diff <= if_exists_ttl:
            print(
                f"skipped download for {dest.name} as it already exists and it is within TTL limits ({if_exists_ttl} seconds)"
            )
            return

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


def _run_parallel_downloads(
    futures: dict[Future, str],
    queue: queue.Queue[tuple[str, str, int | None]] | None,
    url_to_dest: dict[str, Path],
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
        except Exception as e:
            failed.append((url, e))

    return failed


def _verify_downloads(
    verify_plan: list[tuple[Path, int, str]], n_workers: int
) -> list[tuple[str, str]]:
    failed: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=n_workers) as pool:
        futures = {
            pool.submit(_verify_file, path, bytes, md5): path
            for path, bytes, md5 in verify_plan
        }

        with tqdm(total=len(futures), unit="file", desc="verifying download") as pbar:
            for future in futures:
                filename, passed, reason = future.result()
                if not passed:
                    failed.append((filename, reason))
                pbar.update(1)

    return failed
