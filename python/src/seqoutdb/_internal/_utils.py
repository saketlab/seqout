import time
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

# accepts the class itself and not an instance of it
T = TypeVar("T", bound=BaseModel)


def _send_get_req(
    client: httpx.Client,
    url: str,
    params: BaseModel,
    response_model: type[T],
    max_attempts: int,
    backoff_factor: float,
    timeout: int,
) -> T:
    for attempt in range(max_attempts):
        try:
            req = client.build_request(
                "GET",
                url,
                params=params.model_dump(exclude_none=True, by_alias=True),
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
