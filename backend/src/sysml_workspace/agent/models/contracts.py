from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping, Sequence

MessageRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True, slots=True)
class ModelMessage:
    role: MessageRole
    content: str

    def __post_init__(self) -> None:
        if self.role not in {"system", "user", "assistant"}:
            raise ValueError(f"Unsupported message role: {self.role}")
        if not self.content.strip():
            raise ValueError("ModelMessage.content must not be blank.")


@dataclass(frozen=True, slots=True)
class ModelRequest:
    messages: Sequence[ModelMessage]
    max_output_tokens: int | None = None
    temperature: float | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.messages:
            raise ValueError("ModelRequest.messages must not be empty.")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be positive.")
        if self.temperature is not None and self.temperature < 0:
            raise ValueError("temperature must be >= 0.")


@dataclass(frozen=True, slots=True)
class ModelUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class ModelResponse:
    text: str
    provider: str
    model: str
    usage: ModelUsage = field(default_factory=ModelUsage)
    finish_reason: str | None = None
    response_id: str | None = None

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("ModelResponse.text must not be blank.")
