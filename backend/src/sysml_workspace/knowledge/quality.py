from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Mapping, Sequence


class QualityStage(StrEnum):
    EXTRACTION = "extraction"
    NORMALIZATION = "normalization"
    CHUNKING = "chunking"
    LIFECYCLE = "lifecycle"
    QUERY_REWRITE = "query_rewrite"
    RETRIEVAL = "retrieval"
    RERANK = "rerank"
    CONTEXT_ASSEMBLY = "context_assembly"


@dataclass(frozen=True, slots=True)
class QualityMetric:
    name: str
    value: float
    threshold: float | None = None
    higher_is_better: bool = True

    @property
    def passed(self) -> bool:
        if self.threshold is None:
            return True
        if self.higher_is_better:
            return self.value >= self.threshold
        return self.value <= self.threshold


@dataclass(frozen=True, slots=True)
class QualityReport:
    stage: QualityStage
    metrics: Sequence[QualityMetric]
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return not self.errors and all(metric.passed for metric in self.metrics)


class QualityGate(ABC):
    @abstractmethod
    async def evaluate(self, value: Any) -> QualityReport:
        raise NotImplementedError
