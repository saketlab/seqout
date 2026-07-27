import logging
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, TypeVar

import requests
from pydantic import BaseModel
from tqdm import tqdm

try:
    _USER_AGENT = f"seqout-lib/{version('seqout')}"
except PackageNotFoundError:  # editable/uninstalled tree
    _USER_AGENT = "seqout-lib"

# accepts the class itself and not an instance of it
T = TypeVar("T", bound=BaseModel)
_RETRYABLE_STATUS_CODES = {429, 443, 500, 502, 503, 504}
_RANGE_NOT_SATISFIABLE = 416
_PARTIAL_CONTENT = 206

logger = logging.getLogger(__name__)


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, requests.HTTPError):
        return (
            exc.response is not None
            and exc.response.status_code in _RETRYABLE_STATUS_CODES
        )

    return isinstance(
        exc,
        (
            requests.ConnectionError,
            requests.Timeout,
            requests.exceptions.ChunkedEncodingError,
        ),
    )


def _send_req[T: BaseModel](
    method: str,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    json: dict | None = None,
    timeout: int,
    num_retries: int,
    max_wait: int,
    stream: bool = False,
    response_model: type[T],
    **kwargs: Any,
) -> T:
    for attempt in range(num_retries):
        try:
            r = requests.request(
                method,
                url,
                params=params,
                headers={"User-Agent": _USER_AGENT, **(headers or {})},
                json=json,
                timeout=timeout,
                stream=stream,
                **kwargs,
            )

            r.raise_for_status()
            return response_model.model_validate(r.json())
        except requests.RequestException as exc:
            if not _is_retryable(exc) or attempt == num_retries - 1:
                raise

            wait = min(2**attempt, max_wait)
            logger.warning(
                "failed to send %s req to %s (attempt %d/%d, retrying in %.0fs) - %s",
                method,
                url,
                attempt + 1,
                num_retries,
                wait,
                exc,
            )

            time.sleep(wait)

    raise RuntimeError(f"failed after {num_retries} retries")


def _download_file(
    url: str,
    dest_path: Path,
    *,
    chunk_size: int,
    num_retries: int,
    timeout: int,
    max_wait: int,
    with_pbar: bool,
) -> None:
    dest_path.parent.mkdir(exist_ok=True, parents=True)
    already_downloaded = dest_path.stat().st_size if dest_path.exists() else 0

    for attempt in range(num_retries):
        bytes_this_attempt = 0
        try:
            headers = {}
            if already_downloaded > 0:
                headers["Range"] = f"bytes={already_downloaded}-"

            r = requests.get(url, headers=headers, stream=True, timeout=timeout)
            if r.status_code == _RANGE_NOT_SATISFIABLE:
                return

            r.raise_for_status()

            content_length = int(r.headers.get("Content-Length", -1))
            if content_length == -1:
                raise ValueError(f"missing Content-Length header for {url}")

            if r.status_code == _PARTIAL_CONTENT:
                open_mode = "ab"
                resumed_from = already_downloaded
            else:
                open_mode = "wb"
                resumed_from = 0

            total = resumed_from + content_length
            pbar = (
                tqdm(
                    total=total,
                    initial=resumed_from,
                    unit="B",
                    unit_scale=True,
                    desc=f"downloading {url[:100]}",
                    leave=False,
                )
                if with_pbar
                else None
            )

            with dest_path.open(open_mode) as f:
                for chunk in r.iter_content(chunk_size):
                    if not chunk:
                        continue
                    f.write(chunk)
                    n = len(chunk)
                    bytes_this_attempt += n
                    already_downloaded += n
                    if pbar:
                        pbar.update(n)

            actual_size = dest_path.stat().st_size
            if actual_size != total:
                raise OSError(
                    f"downloaded {actual_size} bytes, expected {total} for {url}"
                )

            if pbar:
                pbar.close()
            r.close()
        except Exception as exc:
            if not _is_retryable(exc) or attempt == num_retries - 1:
                raise

            already_downloaded -= bytes_this_attempt

            wait = min(2**attempt, max_wait)
            logger.warning(
                "failed to download %s (attempt %d/%d): %s. retrying in %.0fs",
                url,
                attempt + 1,
                num_retries,
                wait,
                exc,
            )
            time.sleep(wait)

    raise RuntimeError(f"failed to download {url} after {num_retries} retries")
