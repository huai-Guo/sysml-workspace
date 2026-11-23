from __future__ import annotations

import asyncio
import difflib
import hashlib
import math
from collections.abc import Awaitable, Callable
from typing import Literal, TypeVar

from langgraph.graph import END, START, StateGraph

from sysml_workspace.agent.models import (
    ModelGateway,
    ModelMessage,
    ModelRequest,
)
from sysml_workspace.agent.models.errors import (
    ModelGatewayError,
    ModelTimeoutError,
)
from sysml_workspace.parser import (
    SysMLDiagnostic,
    SysMLValidator,
    SysMLValidatorError,
    SysMLValidatorTimeoutError,
)

from .prompts import (
    GENERATION_SYSTEM_PROMPT,
    REPAIR_SYSTEM_PROMPT,
    REVISION_SYSTEM_PROMPT,
    build_generation_prompt,
    build_repair_prompt,
)
from .source import normalize_model_source
from .state import (
    CandidateState,
    CandidateStatus,
    DiagnosticState,
    RunInput,
    RunOutput,
    RunState,
    RunStatus,
    ValidationMetadataState,
)

DEFAULT_RUN_TIMEOUT_SECONDS = 300.0
_T = TypeVar("_T")


class _RunDeadlineExceeded(TimeoutError):
    pass


def build_sysml_graph(
    *,
    model_gateway: ModelGateway | None,
    validator: SysMLValidator,
    default_max_repair_count: int = 3,
    default_run_timeout_seconds: float = DEFAULT_RUN_TIMEOUT_SECONDS,
):
    if default_max_repair_count < 0:
        raise ValueError(
            "default_max_repair_count must be >= 0."
        )
    if (
        not math.isfinite(default_run_timeout_seconds)
        or default_run_timeout_seconds <= 0
    ):
        raise ValueError(
            "default_run_timeout_seconds must be finite and positive."
        )

    async def prepare(state: RunState) -> dict:
        task_type = state.get("task_type")
        if task_type not in {
            "generate",
            "revise",
            "repair",
            "validate",
        }:
            raise ValueError(
                "task_type must be generate, revise, "
                "repair, or validate."
            )

        request = state.get("request", "").strip()
        source = state.get("sysml_source", "")
        max_repairs = state.get(
            "max_repair_count",
            default_max_repair_count,
        )
        timeout_seconds = state.get(
            "run_timeout_seconds",
            default_run_timeout_seconds,
        )

        if (
            not isinstance(max_repairs, int)
            or isinstance(max_repairs, bool)
            or max_repairs < 0
        ):
            raise ValueError(
                "max_repair_count must be a non-negative integer."
            )
        if (
            not isinstance(timeout_seconds, (int, float))
            or isinstance(timeout_seconds, bool)
            or not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
        ):
            raise ValueError(
                "run_timeout_seconds must be a finite positive number."
            )
        if task_type in {"generate", "revise"} and not request:
            raise ValueError(
                "generate requires a non-empty request."
            )
        if (
            task_type in {"revise", "repair", "validate"}
            and not source.strip()
        ):
            raise ValueError(
                f"{task_type} requires sysml_source."
            )

        candidates: list[CandidateState] = []
        original_source: str | None = None
        if task_type in {"revise", "repair", "validate"}:
            original_source = source
            candidates.append(_new_candidate(source, "input"))

        loop = asyncio.get_running_loop()
        timeout_seconds = float(timeout_seconds)
        return {
            "request": request,
            "sysml_source": source if task_type != "generate" else "",
            "original_sysml_source": original_source,
            "candidate_history": candidates,
            "diagnostics": [],
            "validation_metadata": _empty_validation_metadata(),
            "semantic_review": {"status": "not_run"},
            "semantic_model": None,
            "valid": False,
            "repair_count": 0,
            "max_repair_count": max_repairs,
            "validation_count": 0,
            "model_calls": 0,
            "run_status": "running",
            "error_message": None,
            "run_timeout_seconds": timeout_seconds,
            "deadline_monotonic": loop.time() + timeout_seconds,
            "final_artifact_sha256": None,
            "source_diff": None,
        }

    async def generate(state: RunState) -> dict:
        calls = state["model_calls"] + 1
        try:
            if model_gateway is None:
                raise RuntimeError(
                    "generate requires a configured ModelGateway."
                )
            response = await _await_before_deadline(
                lambda: model_gateway.generate(
                    ModelRequest(
                        messages=[
                            ModelMessage(
                                role="system",
                                content=GENERATION_SYSTEM_PROMPT,
                            ),
                            ModelMessage(
                                role="user",
                                content=build_generation_prompt(
                                    state["request"]
                                ),
                            ),
                        ]
                    )
                ),
                state,
            )
        except asyncio.CancelledError:
            return _failure_update(
                state,
                "cancelled",
                "Run was cancelled during model generation.",
                model_calls=calls,
            )
        except (ModelTimeoutError, _RunDeadlineExceeded) as exc:
            return _failure_update(
                state,
                "timeout",
                str(exc) or "Model request timed out.",
                model_calls=calls,
            )
        except ModelGatewayError as exc:
            return _failure_update(
                state,
                "model_error",
                str(exc),
                model_calls=calls,
            )
        except Exception as exc:
            return _failure_update(
                state,
                "model_error",
                _exception_message("Model request failed", exc),
                model_calls=calls,
            )

        source = normalize_model_source(response.text)
        history = list(state["candidate_history"])
        history.append(_new_candidate(source, "generated"))
        return {
            "sysml_source": source,
            "candidate_history": history,
            "model_calls": calls,
            "last_model_provider": response.provider,
            "last_model_name": response.model,
        }

    async def validate(state: RunState) -> dict:
        validations = state["validation_count"] + 1
        source = state["sysml_source"]
        source_sha256 = _sha256(source)
        try:
            result = await _await_before_deadline(
                lambda: validator.validate(source),
                state,
            )
        except asyncio.CancelledError:
            return _validation_failure_update(
                state,
                "cancelled",
                "Run was cancelled during validation.",
                source_sha256=source_sha256,
                validation_count=validations,
            )
        except (SysMLValidatorTimeoutError, _RunDeadlineExceeded) as exc:
            return _validation_failure_update(
                state,
                "timeout",
                str(exc) or "Validation timed out.",
                source_sha256=source_sha256,
                validation_count=validations,
            )
        except SysMLValidatorError as exc:
            return _validation_failure_update(
                state,
                "tool_error",
                str(exc),
                source_sha256=source_sha256,
                validation_count=validations,
            )
        except Exception as exc:
            return _validation_failure_update(
                state,
                "tool_error",
                _exception_message("Validator failed", exc),
                source_sha256=source_sha256,
                validation_count=validations,
            )

        if result.source_sha256 and result.source_sha256 != source_sha256:
            return _validation_failure_update(
                state,
                "tool_error",
                "Validator source hash does not match the candidate bytes.",
                source_sha256=source_sha256,
                validation_count=validations,
            )

        diagnostics = [
            _diagnostic_to_state(diagnostic)
            for diagnostic in result.diagnostics
        ]
        status = "valid" if result.valid else "invalid"
        metadata: ValidationMetadataState = {
            "status": status,
            "validator_revision": result.validator_revision,
            "library_revision": result.library_revision,
            "source_sha256": source_sha256,
            "duration_ms": result.duration_ms,
        }
        history = _update_last_candidate(
            state["candidate_history"],
            validation_status=status,
            diagnostics=diagnostics,
        )
        return {
            "valid": result.valid,
            "semantic_model": result.semantic_model,
            "diagnostics": diagnostics,
            "validation_metadata": metadata,
            "candidate_history": history,
            "validation_count": validations,
            "error_message": None,
        }

    async def repair(state: RunState) -> dict:
        calls = state["model_calls"] + 1
        initial_revision = state["task_type"] == "revise" and state["model_calls"] == 0
        repairs = state["repair_count"] + (0 if initial_revision else 1)
        try:
            if model_gateway is None:
                raise RuntimeError(
                    "repair requires a configured ModelGateway."
                )
            response = await _await_before_deadline(
                lambda: model_gateway.generate(
                    ModelRequest(
                        messages=[
                            ModelMessage(
                                role="system",
                                content=REVISION_SYSTEM_PROMPT if initial_revision else REPAIR_SYSTEM_PROMPT,
                            ),
                            ModelMessage(
                                role="user",
                                content=build_repair_prompt(
                                    request=state.get("request", ""),
                                    source=state["sysml_source"],
                                    diagnostics=state["diagnostics"],
                                ),
                            ),
                        ]
                    )
                ),
                state,
            )
        except asyncio.CancelledError:
            return _failure_update(
                state,
                "cancelled",
                "Run was cancelled during repair.",
                model_calls=calls,
                repair_count=repairs,
            )
        except (ModelTimeoutError, _RunDeadlineExceeded) as exc:
            return _failure_update(
                state,
                "timeout",
                str(exc) or "Model request timed out.",
                model_calls=calls,
                repair_count=repairs,
            )
        except ModelGatewayError as exc:
            return _failure_update(
                state,
                "model_error",
                str(exc),
                model_calls=calls,
                repair_count=repairs,
            )
        except Exception as exc:
            return _failure_update(
                state,
                "model_error",
                _exception_message("Model repair failed", exc),
                model_calls=calls,
                repair_count=repairs,
            )

        source = normalize_model_source(response.text)
        history = list(state["candidate_history"])
        history.append(_new_candidate(source, "repair"))
        return {
            "sysml_source": source,
            "candidate_history": history,
            "repair_count": repairs,
            "model_calls": calls,
            "last_model_provider": response.provider,
            "last_model_name": response.model,
        }

    async def finalize(state: RunState) -> dict:
        run_status = state["run_status"]
        if run_status == "running":
            validation_is_valid = (
                state["validation_metadata"]["status"] == "valid"
            )
            if state["valid"] and validation_is_valid:
                run_status = "succeeded"
            elif state["task_type"] == "validate":
                run_status = "invalid"
            else:
                run_status = "repair_exhausted"

        source = state.get("sysml_source", "")
        original_source = state.get("original_sysml_source")
        return {
            "run_status": run_status,
            "final_artifact_sha256": (
                _sha256(source)
                if state.get("candidate_history")
                else None
            ),
            "source_diff": _source_diff(original_source, source),
        }

    def route_after_prepare(
        state: RunState,
    ) -> Literal["generate", "repair", "validate"]:
        if state["task_type"] == "revise":
            return "repair"
        return (
            "generate"
            if state["task_type"] == "generate"
            else "validate"
        )

    def route_after_model(
        state: RunState,
    ) -> Literal["validate", "finalize"]:
        return "validate" if state["run_status"] == "running" else "finalize"

    def route_after_validate(
        state: RunState,
    ) -> Literal["repair", "finalize"]:
        if state["run_status"] != "running" or state["valid"]:
            return "finalize"

        if state["task_type"] == "validate":
            return "finalize"

        if state["repair_count"] >= state["max_repair_count"]:
            return "finalize"

        return "repair"

    graph = StateGraph(
        RunState,
        input_schema=RunInput,
        output_schema=RunOutput,
    )
    graph.add_node("prepare", prepare)
    graph.add_node("generate", generate)
    graph.add_node("validate", validate)
    graph.add_node("repair", repair)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "prepare")
    graph.add_conditional_edges(
        "prepare",
        route_after_prepare,
        {
            "generate": "generate",
            "repair": "repair",
            "validate": "validate",
        },
    )
    graph.add_conditional_edges(
        "generate",
        route_after_model,
        {
            "validate": "validate",
            "finalize": "finalize",
        },
    )
    graph.add_conditional_edges(
        "validate",
        route_after_validate,
        {
            "repair": "repair",
            "finalize": "finalize",
        },
    )
    graph.add_conditional_edges(
        "repair",
        route_after_model,
        {
            "validate": "validate",
            "finalize": "finalize",
        },
    )
    graph.add_edge("finalize", END)

    return graph.compile()


async def _await_before_deadline(
    operation: Callable[[], Awaitable[_T]],
    state: RunState,
) -> _T:
    remaining = state["deadline_monotonic"] - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise _RunDeadlineExceeded("Overall run deadline exceeded.")
    try:
        return await asyncio.wait_for(operation(), timeout=remaining)
    except asyncio.TimeoutError as exc:
        raise _RunDeadlineExceeded("Overall run deadline exceeded.") from exc


def _failure_update(
    state: RunState,
    status: RunStatus,
    message: str,
    *,
    model_calls: int | None = None,
    repair_count: int | None = None,
) -> dict:
    return {
        "run_status": status,
        "semantic_model": None,
        "error_message": message,
        "valid": False,
        "model_calls": (
            model_calls
            if model_calls is not None
            else state["model_calls"]
        ),
        "repair_count": (
            repair_count
            if repair_count is not None
            else state["repair_count"]
        ),
    }


def _validation_failure_update(
    state: RunState,
    status: Literal["tool_error", "timeout", "cancelled"],
    message: str,
    *,
    source_sha256: str,
    validation_count: int,
) -> dict:
    validation_metadata: ValidationMetadataState = {
        "status": status,
        "validator_revision": None,
        "library_revision": None,
        "source_sha256": source_sha256,
        "duration_ms": None,
    }
    history = _update_last_candidate(
        state["candidate_history"],
        validation_status=status,
        diagnostics=[],
    )
    return {
        "run_status": status,
        "error_message": message,
        "valid": False,
        "diagnostics": [],
        "validation_metadata": validation_metadata,
        "semantic_model": None,
        "candidate_history": history,
        "validation_count": validation_count,
    }


def _empty_validation_metadata() -> ValidationMetadataState:
    return {
        "status": "not_run",
        "validator_revision": None,
        "library_revision": None,
        "source_sha256": None,
        "duration_ms": None,
    }


def _new_candidate(
    source: str,
    origin: Literal["input", "generated", "repair"],
) -> CandidateState:
    return {
        "origin": origin,
        "source": source,
        "source_sha256": _sha256(source),
        "validation_status": "not_run",
        "diagnostics": [],
    }


def _update_last_candidate(
    history: list[CandidateState],
    *,
    validation_status: CandidateStatus,
    diagnostics: list[DiagnosticState],
) -> list[CandidateState]:
    updated = list(history)
    if not updated:
        return updated
    updated[-1] = {
        **updated[-1],
        "validation_status": validation_status,
        "diagnostics": diagnostics,
    }
    return updated


def _source_diff(
    original_source: str | None,
    final_source: str,
) -> str | None:
    if original_source is None:
        return None
    return "".join(
        difflib.unified_diff(
            original_source.splitlines(keepends=True),
            final_source.splitlines(keepends=True),
            fromfile="original.sysml",
            tofile="final.sysml",
        )
    )


def _sha256(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _exception_message(prefix: str, error: Exception) -> str:
    detail = str(error).strip() or type(error).__name__
    return f"{prefix}: {detail}"


def _diagnostic_to_state(
    diagnostic: SysMLDiagnostic,
) -> DiagnosticState:
    return {
        "severity": diagnostic.severity,
        "kind": diagnostic.kind,
        "message": diagnostic.message,
        "line": diagnostic.line,
        "column": diagnostic.column,
        "offset": diagnostic.offset,
        "length": diagnostic.length,
        "code": diagnostic.code,
        "source": diagnostic.source,
    }
