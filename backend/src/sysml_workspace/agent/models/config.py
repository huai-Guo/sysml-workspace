from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Literal, cast

from .errors import ModelConfigurationError

ModelProvider = Literal["openai", "anthropic", "openai_compatible", "ollama"]
SUPPORTED_PROVIDERS = {"openai", "anthropic", "openai_compatible", "ollama"}


@dataclass(frozen=True, slots=True)
class ModelGatewayConfig:
    provider: ModelProvider
    model: str
    base_url: str | None = None
    api_key: str | None = field(default=None, repr=False)
    timeout_seconds: float = 60.0
    max_output_tokens: int = 4096

    def __post_init__(self) -> None:
        if self.provider not in SUPPORTED_PROVIDERS:
            raise ModelConfigurationError(f"Unsupported model provider: {self.provider}")
        if not self.model.strip():
            raise ModelConfigurationError("Model name must not be blank.")
        if not math.isfinite(self.timeout_seconds) or not 0 < self.timeout_seconds <= 300:
            raise ModelConfigurationError("timeout_seconds must be positive.")
        if not 0 < self.max_output_tokens <= 16384:
            raise ModelConfigurationError("max_output_tokens must be positive.")
        if self.provider == "openai_compatible" and not self.base_url:
            raise ModelConfigurationError(
                "openai_compatible requires SYSML_AGENT_MODEL_BASE_URL/base_url."
            )

    @classmethod
    def from_env(cls) -> "ModelGatewayConfig":
        raw_provider = os.getenv("SYSML_AGENT_MODEL_PROVIDER", "").strip()
        model = os.getenv("SYSML_AGENT_MODEL_NAME", "").strip()

        if raw_provider not in SUPPORTED_PROVIDERS:
            raise ModelConfigurationError(
                "SYSML_AGENT_MODEL_PROVIDER must be one of: "
                "openai, anthropic, openai_compatible, ollama."
            )
        if not model:
            raise ModelConfigurationError("SYSML_AGENT_MODEL_NAME is required.")

        api_key = os.getenv("SYSML_AGENT_MODEL_API_KEY")
        if not api_key:
            if raw_provider in {"openai", "openai_compatible"}:
                api_key = os.getenv("OPENAI_API_KEY")
            elif raw_provider == "anthropic":
                api_key = os.getenv("ANTHROPIC_API_KEY")

        try:
            timeout = float(os.getenv("SYSML_AGENT_MODEL_TIMEOUT_SECONDS", "60"))
            max_output = int(os.getenv("SYSML_AGENT_MODEL_MAX_OUTPUT_TOKENS", "4096"))
        except ValueError as exc:
            raise ModelConfigurationError(
                "Model timeout/max output token environment values are invalid."
            ) from exc

        return cls(
            provider=cast(ModelProvider, raw_provider),
            model=model,
            base_url=os.getenv("SYSML_AGENT_MODEL_BASE_URL"),
            api_key=api_key,
            timeout_seconds=timeout,
            max_output_tokens=max_output,
        )
