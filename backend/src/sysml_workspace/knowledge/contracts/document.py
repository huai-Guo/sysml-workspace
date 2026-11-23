from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping, Sequence

SourceType = Literal[
    "website",
    "docx",
    "pdf",
    "scan",
    "image",
    "text",
    "other",
]

BlockType = Literal[
    "title",
    "heading",
    "paragraph",
    "list",
    "table",
    "figure",
    "figure_caption",
    "equation",
    "code",
    "header",
    "footer",
    "other",
]


@dataclass(frozen=True, slots=True)
class BoundingBox:
    x0: float
    y0: float
    x1: float
    y1: float

    def __post_init__(self) -> None:
        if self.x1 < self.x0 or self.y1 < self.y0:
            raise ValueError("BoundingBox max coordinates must be >= min coordinates.")


@dataclass(frozen=True, slots=True)
class Provenance:
    source_uri: str
    locator: str
    page_number: int | None = None
    bbox: BoundingBox | None = None
    extractor: str | None = None
    extractor_version: str | None = None
    extraction_confidence: float | None = None

    def __post_init__(self) -> None:
        if not self.source_uri.strip():
            raise ValueError("Provenance.source_uri must not be blank.")
        if not self.locator.strip():
            raise ValueError("Provenance.locator must not be blank.")
        if self.page_number is not None and self.page_number < 1:
            raise ValueError("page_number must be >= 1.")
        if (
            self.extraction_confidence is not None
            and not 0 <= self.extraction_confidence <= 1
        ):
            raise ValueError("extraction_confidence must be within [0, 1].")


@dataclass(frozen=True, slots=True)
class DocumentBlock:
    block_id: str
    block_type: BlockType
    content: str
    provenance: Provenance
    section_path: tuple[str, ...] = ()
    parent_id: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.block_id.strip():
            raise ValueError("block_id must not be blank.")
        if not self.content.strip() and self.block_type not in {
            "figure",
            "equation",
        }:
            raise ValueError("Textual block content must not be blank.")


@dataclass(frozen=True, slots=True)
class DocumentIR:
    document_id: str
    source_type: SourceType
    source_uri: str
    source_hash: str
    blocks: Sequence[DocumentBlock]
    title: str | None = None
    domain: str | None = None
    version: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.document_id.strip():
            raise ValueError("document_id must not be blank.")
        if not self.source_uri.strip():
            raise ValueError("source_uri must not be blank.")
        if not self.source_hash.strip():
            raise ValueError("source_hash must not be blank.")
        if not self.blocks:
            raise ValueError("DocumentIR.blocks must not be empty.")
