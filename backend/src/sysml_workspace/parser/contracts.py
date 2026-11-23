from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DiagnosticSeverity = Literal["error", "warning", "info", "ignore"]
DiagnosticKind = Literal["syntax", "semantic", "internal"]


@dataclass(frozen=True, slots=True)
class SysMLDiagnostic:
    severity: DiagnosticSeverity
    kind: DiagnosticKind
    message: str
    line: int | None = None
    column: int | None = None
    offset: int | None = None
    length: int | None = None
    code: str | None = None
    source: str = "omg-pilot"


@dataclass(frozen=True, slots=True)
class SysMLValidationResult:
    valid: bool
    diagnostics: tuple[SysMLDiagnostic, ...]
    validator_name: str | None = None
    validator_version: str | None = None
    validator_tag: str | None = None
    validator_revision: str | None = None
    library_revision: str | None = None
    source_sha256: str | None = None
    duration_ms: float | None = None
    semantic_model: dict | None = None
