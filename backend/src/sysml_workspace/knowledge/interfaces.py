from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Sequence

from .contracts.document import DocumentIR
from .contracts.enrichment import (
    EnrichedRequest,
    EnrichmentRequest,
    KnowledgeChunk,
    RetrievalPlan,
)


class DocumentExtractor(ABC):
    @abstractmethod
    async def extract(self, source: str) -> DocumentIR:
        raise NotImplementedError


class DocumentNormalizer(ABC):
    @abstractmethod
    async def normalize(self, document: DocumentIR) -> DocumentIR:
        raise NotImplementedError


class Chunker(ABC):
    @abstractmethod
    async def chunk(self, document: DocumentIR) -> Sequence[KnowledgeChunk]:
        raise NotImplementedError


class KnowledgeStore(ABC):
    @abstractmethod
    async def upsert(
        self,
        document: DocumentIR,
        chunks: Sequence[KnowledgeChunk],
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    async def delete(self, document_id: str) -> None:
        raise NotImplementedError


class QueryPlanner(ABC):
    @abstractmethod
    async def plan(self, request: EnrichmentRequest) -> RetrievalPlan:
        raise NotImplementedError


class Retriever(ABC):
    @abstractmethod
    async def retrieve(self, plan: RetrievalPlan) -> Sequence[KnowledgeChunk]:
        raise NotImplementedError


class Reranker(ABC):
    @abstractmethod
    async def rerank(
        self,
        request: EnrichmentRequest,
        candidates: Sequence[KnowledgeChunk],
        limit: int,
    ) -> Sequence[KnowledgeChunk]:
        raise NotImplementedError


class ContextAssembler(ABC):
    @abstractmethod
    async def assemble(
        self,
        request: EnrichmentRequest,
        chunks: Sequence[KnowledgeChunk],
    ) -> str:
        raise NotImplementedError


class KnowledgeEnricher(ABC):
    @abstractmethod
    async def enrich(self, request: EnrichmentRequest) -> EnrichedRequest:
        raise NotImplementedError
