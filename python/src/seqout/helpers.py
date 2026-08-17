import logging
import random
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import requests
from pydantic import BaseModel
from requests.adapters import HTTPAdapter

try:
    _USER_AGENT = f"seqout-lib/{version('seqout')}"
except PackageNotFoundError:  # editable/uninstalled tree
    _USER_AGENT = "seqout-lib"

# NCBI answers throttled requests with Forbidden
_RETRYABLE_STATUS_CODES = {403, 408, 429, 500, 502, 503, 504}
_RANGE_NOT_SATISFIABLE = 416
_PARTIAL_CONTENT = 206
_MAX_RETRY_AFTER = 120

logger = logging.getLogger(__name__)

# shared session reuses TCP and TLS; these hosts throttle connection churn
_session = requests.Session()
_session.headers["User-Agent"] = _USER_AGENT
_adapter = HTTPAdapter(pool_connections=16, pool_maxsize=32)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)


def _backoff(attempt: int, max_wait: int) -> float:
    """
    Full-jitter exponential backoff.

    A deterministic wait makes every throttled worker retry at the same instant,
    so the burst that caused the throttling re-forms. Spreading each wait over
    zero to cap breaks that lockstep.
    """
    return random.uniform(0, min(2**attempt, max_wait))  # noqa: S311


def _retry_after(exc: Exception, fallback: float) -> float:
    response = getattr(exc, "response", None)
    if response is None:
        return fallback
    try:
        after = float(response.headers.get("Retry-After", fallback))
    except (TypeError, ValueError):
        return fallback
    else:
        return min(after, _MAX_RETRY_AFTER)


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
    response_model: type[T] | None = None,
    **kwargs: Any,
) -> T | str:
    for attempt in range(num_retries):
        try:
            r = _session.request(
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
            # No model means the endpoint answers text, not JSON: /cite sends
            # BibTeX, which has nothing to validate.
            if response_model is None:
                return r.text
            return response_model.model_validate(r.json())
        except requests.RequestException as exc:
            if not _is_retryable(exc) or attempt == num_retries - 1:
                raise

            wait = _retry_after(exc, _backoff(attempt, max_wait))
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
            # NCBI can report compressed Content-Length for already-compressed payloads
            headers = {"Accept-Encoding": "identity"}
            if already_downloaded > 0:
                headers["Range"] = f"bytes={already_downloaded}-"

            r = _session.get(url, headers=headers, stream=True, timeout=timeout)
            if r.status_code == _RANGE_NOT_SATISFIABLE:
                return

            r.raise_for_status()

            content_length = int(r.headers.get("Content-Length", -1))
            if content_length == -1:
                raise ValueError(f"missing Content-Length header for {url}")

            # some servers ignore Accept-Encoding; encoded Content-Length is wire size
            encoded = r.headers.get("Content-Encoding") not in (None, "identity")

            if r.status_code == _PARTIAL_CONTENT and not encoded:
                open_mode = "ab"
                resumed_from = already_downloaded
            else:
                open_mode = "wb"
                resumed_from = 0
                already_downloaded = 0

            # tqdm.auto probes ipywidgets at import time and warns in notebooks.
            from tqdm.auto import tqdm  # noqa: PLC0415

            total = resumed_from + content_length
            pbar = tqdm(
                total=total,
                initial=resumed_from,
                unit="B",
                unit_scale=True,
                desc=dest_path.name[:40],
                leave=False,
                disable=None if with_pbar else True,
            )

            with dest_path.open(open_mode) as f:
                for chunk in r.iter_content(chunk_size):
                    if not chunk:
                        continue
                    f.write(chunk)
                    n = len(chunk)
                    bytes_this_attempt += n
                    already_downloaded += n
                    pbar.update(n)

            actual_size = dest_path.stat().st_size
            if encoded:
                logger.debug("%s served with Content-Encoding; size check skipped", url)
            elif actual_size != total:
                raise OSError(
                    f"downloaded {actual_size} bytes, expected {total} for {url}"
                )

            pbar.close()
            r.close()
        except Exception as exc:
            if not _is_retryable(exc) or attempt == num_retries - 1:
                raise

            already_downloaded -= bytes_this_attempt
            # truncate first; the Range retry appends from the restored offset
            if dest_path.exists() and dest_path.stat().st_size > already_downloaded:
                with dest_path.open("r+b") as f:
                    f.truncate(already_downloaded)

            wait = _retry_after(exc, _backoff(attempt, max_wait))
            logger.warning(
                "failed to download %s (attempt %d/%d): %s. retrying in %.0fs",
                url,
                attempt + 1,
                num_retries,
                wait,
                exc,
            )
            time.sleep(wait)
        else:
            return

    raise RuntimeError(f"failed to download {url} after {num_retries} retries")
