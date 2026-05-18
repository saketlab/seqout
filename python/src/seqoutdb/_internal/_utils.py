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
) -> T:
    try:
        response = client.get(
            url,
            params=params.model_dump(exclude_none=True, by_alias=True),
        )
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

    except httpx.TimeoutException:
        raise TimeoutError("request timed out") from None

    except httpx.NetworkError:
        raise ConnectionError("could not connect to seqout") from None

    except ValidationError as e:
        raise ValueError(f"unexpected response format: {e}") from e
