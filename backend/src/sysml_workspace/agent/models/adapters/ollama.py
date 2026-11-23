from __future__ import annotations

from typing import Any

import httpx

from .._http import JsonHttpClient
from ..base import ModelGateway
from ..contracts import ModelRequest, ModelResponse, ModelUsage
from ..errors import ModelResponseError


class OllamaGateway(ModelGateway):
    def __init__(
        self,
        *,
        model: str,
        base_url: str = "http://localhost:11434",
        timeout_seconds: float = 120.0,
        default_max_output_tokens: int = 4096,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._model = model
        self._default_max_output_tokens = default_max_output_tokens
        self._http = JsonHttpClient(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            transport=transport,
        )

    async def generate(self, request: ModelRequest) -> ModelResponse:
        options: dict[str, Any] = {
            "num_predict": (
                request.max_output_tokens or self._default_max_output_tokens
            )
        }
        if request.temperature is not None:
            options["temperature"] = request.temperature

        payload = {
            "model": self._model,
            "messages": [
                {"role": message.role, "content": message.content}
                for message in request.messages
            ],
            "stream": False,
            "options": options,
        }

        data = await self._http.post("/api/chat", payload)
        message = data.get("message")
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise ModelResponseError("Ollama response contained no text output.")

        input_tokens = _as_int(data.get("prompt_eval_count"))
        output_tokens = _as_int(data.get("eval_count"))
        total_tokens = (
            input_tokens + output_tokens
            if input_tokens is not None and output_tokens is not None
            else None
        )

        return ModelResponse(
            text=text,
            provider="ollama",
            model=str(data.get("model") or self._model),
            usage=ModelUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
            ),
            finish_reason=_as_str(data.get("done_reason")),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


def _as_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None
