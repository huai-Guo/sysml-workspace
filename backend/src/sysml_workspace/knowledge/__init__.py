"""engineering-rag runtime public contracts."""

from .contracts.document import (
    BoundingBox,
    DocumentBlock,
    DocumentIR,
    Provenance,
)
from .contracts.enrichment import (
    EnrichedRequest,
    EnrichmentRequest,
    KnowledgeChunk,
    RetrievalPlan,
    RetrievalQuery,
)
from .contracts.lifecycle import (
    DocumentStatus,
    LifecycleMetadata,
)
from .quality import (
    QualityGate,
    QualityMetric,
    QualityReport,
    QualityStage,
)

__all__ = [
    "BoundingBox",
    "DocumentBlock",
    "DocumentIR",
    "DocumentStatus",
    "EnrichedRequest",
    "EnrichmentRequest",
    "KnowledgeChunk",
    "LifecycleMetadata",
    "Provenance",
    "QualityGate",
    "QualityMetric",
    "QualityReport",
    "QualityStage",
    "RetrievalPlan",
    "RetrievalQuery",
]
