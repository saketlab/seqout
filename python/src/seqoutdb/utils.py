import os
import queue
import time
from pathlib import Path
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from seqoutdb.constants import COUNTRY_CODE_MAP, COUNTRY_NAME_MAP

# accepts the class itself and not an instance of it
T = TypeVar("T", bound=BaseModel)


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


def _download_file(
    url: str, dest: Path, chunk_size: int, queue: queue.Queue | None = None
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


def country_name_to_code(name: str) -> str | None:
    return COUNTRY_NAME_MAP.get(name)


def country_code_to_name(code: str) -> str | None:
    return COUNTRY_CODE_MAP.get(code)
