from __future__ import annotations

from typing import Literal, TypedDict

TaskType = Literal["generate", "revise", "repair", "validate"]
RunStatus = Literal[
    "running",
    "succeeded",
    "invalid",
    "repair_exhausted",
    "tool_error",
    "model_error",
    "timeout",
    "cancelled",
]
ValidationStatus = Literal[
    "not_run",
    "valid",
    "invalid",
    "tool_error",
    "timeout",
    "cancelled",
]
CandidateStatus = Literal[
    "not_run",
    "valid",
    "invalid",
    "tool_error",
    "timeout",
    "cancelled",
]


class DiagnosticState(TypedDict):
    severity: str
    kind: str
    message: str
    line: int | None
    column: int | None
    offset: int | None
    length: int | None
    code: str | None
    source: str


class ValidationMetadataState(TypedDict):
    status: ValidationStatus
    validator_revision: str | None
    library_revision: str | None
    source_sha256: str | None
    duration_ms: float | None


class CandidateState(TypedDict):
    origin: Literal["input", "generated", "repair"]
    source: str
    source_sha256: str
    validation_status: CandidateStatus
    diagnostics: list[DiagnosticState]


class SemanticReviewState(TypedDict):
    status: Literal["not_run"]


class RunState(TypedDict, total=False):
    semantic_model: dict | None
    task_type: TaskType
    request: str
    sysml_source: str
    original_sysml_source: str | None
    candidate_history: list[CandidateState]
    diagnostics: list[DiagnosticState]
    validation_metadata: ValidationMetadataState
    semantic_review: SemanticReviewState
    valid: bool
    repair_count: int
    max_repair_count: int
    validation_count: int
    model_calls: int
    run_status: RunStatus
    error_message: str | None
    run_timeout_seconds: float
    deadline_monotonic: float
    final_artifact_sha256: str | None
    source_diff: str | None
    last_model_provider: str
    last_model_name: str


class RunInput(TypedDict, total=False):
    task_type: TaskType
    request: str
    sysml_source: str
    max_repair_count: int
    run_timeout_seconds: float


class RunOutput(TypedDict):
    semantic_model: dict | None
    task_type: TaskType
    request: str
    sysml_source: str
    original_sysml_source: str | None
    candidate_history: list[CandidateState]
    diagnostics: list[DiagnosticState]
    validation_metadata: ValidationMetadataState
    semantic_review: SemanticReviewState
    valid: bool
    repair_count: int
    validation_count: int
    model_calls: int
    run_status: RunStatus
    error_message: str | None
    run_timeout_seconds: float
    final_artifact_sha256: str | None
    source_diff: str | None
