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
        # Auto-load .env if present
        from pathlib import Path
        for env_path in (Path.cwd() / ".env", Path(__file__).resolve().parents[4] / ".env"):
            if env_path.is_file():
                try:
                    for line in env_path.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            os.environ[k.strip()] = v.strip()
                except Exception:
                    pass

        raw_provider = os.getenv("SYSML_AGENT_MODEL_PROVIDER", "").strip()
        model = os.getenv("SYSML_AGENT_MODEL_NAME", "").strip()

        # Sensible defaults when BLUE_GATEWAY_API_KEY is configured
        if os.getenv("BLUE_GATEWAY_API_KEY"):
            if not raw_provider:
                raw_provider = "openai_compatible"
            if not model:
                model = "glm-5.3"

        if raw_provider not in SUPPORTED_PROVIDERS:
            raise ModelConfigurationError(
                "SYSML_AGENT_MODEL_PROVIDER must be one of: "
                "openai, anthropic, openai_compatible, ollama."
            )
        if not model:
            raise ModelConfigurationError("SYSML_AGENT_MODEL_NAME is required.")

        api_key = os.getenv("SYSML_AGENT_MODEL_API_KEY") or os.getenv("BLUE_GATEWAY_API_KEY")
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

        base_url = os.getenv("SYSML_AGENT_MODEL_BASE_URL")
        if not base_url and os.getenv("BLUE_GATEWAY_API_KEY"):
            base_url = "https://st8tp3ajl0df3n8b8l8qu.apigateway-cn-beijing.volceapi.com/v1"

        return cls(
            provider=cast(ModelProvider, raw_provider),
            model=model,
            base_url=base_url,
            api_key=api_key,
            timeout_seconds=timeout,
            max_output_tokens=max_output,
        )
