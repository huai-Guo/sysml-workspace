from __future__ import annotations

from abc import ABC, abstractmethod

from .contracts import SysMLValidationResult


class SysMLValidatorError(RuntimeError):
    """The deterministic validator could not complete validation."""


class SysMLValidatorTimeoutError(SysMLValidatorError):
    """The deterministic validator exceeded its per-call time limit."""


class SysMLValidator(ABC):
    """Project-owned deterministic SysML validation boundary."""

    @abstractmethod
    async def validate(self, source: str) -> SysMLValidationResult:
        raise NotImplementedError
