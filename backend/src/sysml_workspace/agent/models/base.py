from __future__ import annotations

from abc import ABC, abstractmethod
from types import TracebackType

from .contracts import ModelRequest, ModelResponse


class ModelGateway(ABC):
    """Project-owned model boundary."""

    @abstractmethod
    async def generate(self, request: ModelRequest) -> ModelResponse:
        raise NotImplementedError

    async def aclose(self) -> None:
        """Release provider resources.

        Non-HTTP gateways may keep the default no-op implementation.
        """
        return None

    async def __aenter__(self) -> "ModelGateway":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()
