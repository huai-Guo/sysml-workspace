from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping, Sequence

QueryKind = Literal[
    "lexical",
    "semantic",
    "metadata",
    "graph",
    "hybrid",
]


@dataclass(frozen=True, slots=True)
class EnrichmentRequest:
    text: str
    domain_hint: str | None = None
    project_id: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("EnrichmentRequest.text must not be blank.")


@dataclass(frozen=True, slots=True)
class RetrievalQuery:
    text: str
    kind: QueryKind
    domain: str | None = None
    priority: int = 0
    metadata_filters: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("RetrievalQuery.text must not be blank.")


@dataclass(frozen=True, slots=True)
class RetrievalPlan:
    queries: Sequence[RetrievalQuery]
    candidate_limit: int = 50
    rerank_limit: int = 8

    def __post_init__(self) -> None:
        if not self.queries:
            raise ValueError("RetrievalPlan.queries must not be empty.")
        if self.candidate_limit <= 0:
            raise ValueError("candidate_limit must be positive.")
        if self.rerank_limit <= 0:
            raise ValueError("rerank_limit must be positive.")
        if self.rerank_limit > self.candidate_limit:
            raise ValueError("rerank_limit cannot exceed candidate_limit.")


@dataclass(frozen=True, slots=True)
class KnowledgeChunk:
    chunk_id: str
    document_id: str
    content: str
    source_uri: str
    locator: str
    domain: str | None = None
    version: str | None = None
    retrieval_score: float | None = None
    rerank_score: float | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.chunk_id.strip():
            raise ValueError("chunk_id must not be blank.")
        if not self.document_id.strip():
            raise ValueError("document_id must not be blank.")
        if not self.content.strip():
            raise ValueError("KnowledgeChunk.content must not be blank.")
        if not self.locator.strip():
            raise ValueError("KnowledgeChunk.locator must not be blank.")


@dataclass(frozen=True, slots=True)
class EnrichedRequest:
    original_request: str
    normalized_intent: str
    domain: str | None
    retrieval_plan: RetrievalPlan
    knowledge: Sequence[KnowledgeChunk]
    assembled_context: str

    def __post_init__(self) -> None:
        if not self.original_request.strip():
            raise ValueError("original_request must not be blank.")
        if not self.normalized_intent.strip():
            raise ValueError("normalized_intent must not be blank.")
