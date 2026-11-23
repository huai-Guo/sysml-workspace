from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class DocumentStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    SUPERSEDED = "superseded"
    EXPIRED = "expired"
    WITHDRAWN = "withdrawn"
    DELETED = "deleted"


@dataclass(frozen=True, slots=True)
class LifecycleMetadata:
    status: DocumentStatus
    ingested_at: datetime
    last_checked_at: datetime
    source_updated_at: datetime | None = None
    effective_at: datetime | None = None
    expires_at: datetime | None = None
    supersedes_document_id: str | None = None
    parser_name: str | None = None
    parser_version: str | None = None
    index_version: str | None = None

    def __post_init__(self) -> None:
        if self.last_checked_at < self.ingested_at:
            raise ValueError("last_checked_at cannot precede ingested_at.")
        if (
            self.effective_at is not None
            and self.expires_at is not None
            and self.expires_at < self.effective_at
        ):
            raise ValueError("expires_at cannot precede effective_at.")
