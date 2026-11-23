from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from .errors import (
    ModelProviderError,
    ModelResponseError,
    ModelTimeoutError,
    ModelTransportError,
)


class JsonHttpClient:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float,
        headers: dict[str, str] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            timeout=timeout_seconds,
            headers=headers,
            transport=transport,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    async def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with (
                asyncio.timeout(self._timeout_seconds),
                self._client.stream("POST", path.lstrip("/"), json=payload) as response,
            ):
                # Do not include provider bodies/URLs in user-visible errors: they may echo secrets.
                if response.status_code >= 300:
                    raise ModelProviderError(f"Provider HTTP {response.status_code}.")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 1024 * 1024:
                        raise ModelResponseError("Provider response exceeds 1 MiB.")
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise ModelTimeoutError("The model provider request timed out.") from exc
        except httpx.HTTPError as exc:
            raise ModelTransportError("The model provider could not be reached.") from exc

        try:
            data = json.loads(body)
        except ValueError as exc:
            raise ModelResponseError("Provider returned non-JSON response.") from exc

        if not isinstance(data, dict):
            raise ModelResponseError("Provider JSON response must be an object.")
        return data

    async def aclose(self) -> None:
        await self._client.aclose()
