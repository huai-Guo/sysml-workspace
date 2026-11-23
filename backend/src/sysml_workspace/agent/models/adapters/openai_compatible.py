from __future__ import annotations

from typing import Any

import httpx

from .._http import JsonHttpClient
from ..base import ModelGateway
from ..contracts import ModelRequest, ModelResponse, ModelUsage
from ..errors import ModelResponseError


class OpenAICompatibleGateway(ModelGateway):
    """Chat Completions adapter for vLLM, LM Studio and compatible servers."""

    def __init__(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str | None = None,
        timeout_seconds: float = 60.0,
        default_max_output_tokens: int = 4096,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._model = model
        self._default_max_output_tokens = default_max_output_tokens
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
        self._http = JsonHttpClient(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            headers=headers,
            transport=transport,
        )

    async def generate(self, request: ModelRequest) -> ModelResponse:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": message.role, "content": message.content}
                for message in request.messages
            ],
            "max_tokens": (
                request.max_output_tokens or self._default_max_output_tokens
            ),
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature

        data = await self._http.post("/chat/completions", payload)
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ModelResponseError("OpenAI-compatible response has no choices.")

        first = choices[0]
        if not isinstance(first, dict):
            raise ModelResponseError("OpenAI-compatible choice must be an object.")

        message = first.get("message")
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise ModelResponseError(
                "OpenAI-compatible response contained no text output."
            )

        if first.get("finish_reason") in {"length", "content_filter", "tool_calls"}:
            raise ModelResponseError("Provider returned incomplete or non-source output.")
        usage_data = data.get("usage") or {}
        if not isinstance(usage_data, dict):
            raise ModelResponseError("Provider usage must be an object.")
        return ModelResponse(
            text=text,
            provider="openai_compatible",
            model=str(data.get("model") or self._model),
            usage=ModelUsage(
                input_tokens=_as_int(usage_data.get("prompt_tokens")),
                output_tokens=_as_int(usage_data.get("completion_tokens")),
                total_tokens=_as_int(usage_data.get("total_tokens")),
            ),
            finish_reason=_as_str(first.get("finish_reason")),
            response_id=_as_str(data.get("id")),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


def _as_int(value: Any) -> int | None:
    return value if type(value) is int and value >= 0 else None


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None
