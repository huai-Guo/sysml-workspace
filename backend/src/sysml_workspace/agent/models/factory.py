from __future__ import annotations

import httpx

from .adapters import (
    AnthropicMessagesGateway,
    OllamaGateway,
    OpenAICompatibleGateway,
    OpenAIResponsesGateway,
)
from .base import ModelGateway
from .config import ModelGatewayConfig


def create_model_gateway(
    config: ModelGatewayConfig,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ModelGateway:
    common = {
        "model": config.model,
        "timeout_seconds": config.timeout_seconds,
        "default_max_output_tokens": config.max_output_tokens,
        "transport": transport,
    }

    if config.provider == "openai":
        return OpenAIResponsesGateway(
            **common,
            api_key=config.api_key,
            base_url=config.base_url or "https://api.openai.com/v1",
        )

    if config.provider == "anthropic":
        return AnthropicMessagesGateway(
            **common,
            api_key=config.api_key,
            base_url=config.base_url or "https://api.anthropic.com",
        )

    if config.provider == "openai_compatible":
        return OpenAICompatibleGateway(
            **common,
            api_key=config.api_key,
            base_url=config.base_url or "",
        )

    if config.provider == "ollama":
        return OllamaGateway(
            **common,
            base_url=config.base_url or "http://localhost:11434",
        )

    raise AssertionError(f"Unhandled provider: {config.provider}")
