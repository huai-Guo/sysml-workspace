from __future__ import annotations

from typing import Any

import httpx

from .._http import JsonHttpClient
from ..base import ModelGateway
from ..contracts import ModelRequest, ModelResponse, ModelUsage
from ..errors import ModelConfigurationError, ModelResponseError


class AnthropicMessagesGateway(ModelGateway):
    def __init__(
        self,
        *,
        model: str,
        api_key: str | None,
        base_url: str = "https://api.anthropic.com",
        timeout_seconds: float = 60.0,
        default_max_output_tokens: int = 4096,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise ModelConfigurationError(
                "Anthropic requires an API key "
                "(SYSML_AGENT_MODEL_API_KEY or ANTHROPIC_API_KEY)."
            )
        self._model = model
        self._default_max_output_tokens = default_max_output_tokens
        self._http = JsonHttpClient(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            transport=transport,
        )

    async def generate(self, request: ModelRequest) -> ModelResponse:
        system_parts = [m.content for m in request.messages if m.role == "system"]
        messages = [
            {"role": m.role, "content": m.content}
            for m in request.messages
            if m.role != "system"
        ]

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": (
                request.max_output_tokens or self._default_max_output_tokens
            ),
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)
        if request.temperature is not None:
            payload["temperature"] = request.temperature

        data = await self._http.post("/v1/messages", payload)
        content = data.get("content")
        parts: list[str] = []
        if isinstance(content, list):
            for block in content:
                if (
                    isinstance(block, dict)
                    and block.get("type") == "text"
                    and isinstance(block.get("text"), str)
                ):
                    parts.append(block["text"])

        text = "".join(parts).strip()
        if not text:
            raise ModelResponseError("Anthropic response contained no text output.")

        usage_data = data.get("usage") or {}
        input_tokens = _as_int(usage_data.get("input_tokens"))
        output_tokens = _as_int(usage_data.get("output_tokens"))
        total_tokens = (
            input_tokens + output_tokens
            if input_tokens is not None and output_tokens is not None
            else None
        )

        return ModelResponse(
            text=text,
            provider="anthropic",
            model=str(data.get("model") or self._model),
            usage=ModelUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
            ),
            finish_reason=_as_str(data.get("stop_reason")),
            response_id=_as_str(data.get("id")),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


def _as_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None
