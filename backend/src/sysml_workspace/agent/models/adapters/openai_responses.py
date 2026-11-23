from __future__ import annotations

from typing import Any

import httpx

from .._http import JsonHttpClient
from ..base import ModelGateway
from ..contracts import ModelRequest, ModelResponse, ModelUsage
from ..errors import ModelConfigurationError, ModelResponseError


class OpenAIResponsesGateway(ModelGateway):
    def __init__(
        self,
        *,
        model: str,
        api_key: str | None,
        base_url: str = "https://api.openai.com/v1",
        timeout_seconds: float = 60.0,
        default_max_output_tokens: int = 4096,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise ModelConfigurationError(
                "OpenAI requires an API key "
                "(SYSML_AGENT_MODEL_API_KEY or OPENAI_API_KEY)."
            )
        self._model = model
        self._default_max_output_tokens = default_max_output_tokens
        self._http = JsonHttpClient(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            headers={"Authorization": f"Bearer {api_key}"},
            transport=transport,
        )

    async def generate(self, request: ModelRequest) -> ModelResponse:
        system_parts = [m.content for m in request.messages if m.role == "system"]
        input_messages = [
            {"role": m.role, "content": m.content}
            for m in request.messages
            if m.role != "system"
        ]

        payload: dict[str, Any] = {
            "model": self._model,
            "input": input_messages,
            "max_output_tokens": (
                request.max_output_tokens or self._default_max_output_tokens
            ),
        }
        if system_parts:
            payload["instructions"] = "\n\n".join(system_parts)
        if request.temperature is not None:
            payload["temperature"] = request.temperature

        data = await self._http.post("/responses", payload)
        usage_data = data.get("usage") or {}

        return ModelResponse(
            text=_extract_output_text(data),
            provider="openai",
            model=str(data.get("model") or self._model),
            usage=ModelUsage(
                input_tokens=_as_int(usage_data.get("input_tokens")),
                output_tokens=_as_int(usage_data.get("output_tokens")),
                total_tokens=_as_int(usage_data.get("total_tokens")),
            ),
            finish_reason=_as_str(data.get("status")),
            response_id=_as_str(data.get("id")),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


def _extract_output_text(data: dict[str, Any]) -> str:
    direct = data.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct

    parts: list[str] = []
    output = data.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if (
                    isinstance(block, dict)
                    and block.get("type") in {"output_text", "text"}
                    and isinstance(block.get("text"), str)
                ):
                    parts.append(block["text"])

    text = "".join(parts).strip()
    if not text:
        raise ModelResponseError("OpenAI response contained no text output.")
    return text


def _as_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None
