from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
from pathlib import Path

from sysml_workspace.agent.models import (
    ModelGateway,
    ModelGatewayConfig,
    create_model_gateway,
)
from sysml_workspace.agent.models.errors import ModelGatewayError
from sysml_workspace.parser import (
    PilotSubprocessValidator,
    SysMLValidatorError,
)

from .workflow import DEFAULT_RUN_TIMEOUT_SECONDS, build_sysml_graph


async def _run(args: argparse.Namespace) -> int:
    source = ""
    gateway: ModelGateway | None = None
    result: dict[str, object]

    try:
        if getattr(args, "file", None):
            source = Path(args.file).read_text(encoding="utf-8")

        if args.task_type != "validate":
            config = ModelGatewayConfig.from_env()
            gateway = create_model_gateway(config)

        validator = PilotSubprocessValidator(
            timeout_seconds=args.validator_timeout_seconds,
        )
        graph = build_sysml_graph(
            model_gateway=gateway,
            validator=validator,
            default_max_repair_count=args.max_repairs,
            default_run_timeout_seconds=args.run_timeout_seconds,
        )

        input_state: dict[str, object] = {
            "task_type": args.task_type,
            "max_repair_count": args.max_repairs,
            "run_timeout_seconds": args.run_timeout_seconds,
        }

        if args.task_type == "generate":
            input_state["request"] = args.request
        else:
            input_state["sysml_source"] = source
            if args.task_type == "repair":
                input_state["request"] = args.request or ""

        result = await graph.ainvoke(input_state)
    except asyncio.CancelledError:
        result = _error_result(
            args,
            source,
            status="cancelled",
            message="Run was cancelled.",
        )
    except ModelGatewayError as exc:
        result = _error_result(
            args,
            source,
            status="model_error",
            message=str(exc),
        )
    except (OSError, SysMLValidatorError, ValueError) as exc:
        result = _error_result(
            args,
            source,
            status="tool_error",
            message=str(exc).strip() or type(exc).__name__,
        )
    finally:
        if gateway is not None:
            await gateway.aclose()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return _exit_code(str(result["run_status"]))


def _error_result(
    args: argparse.Namespace,
    source: str,
    *,
    status: str,
    message: str,
) -> dict[str, object]:
    task_type = args.task_type
    request = getattr(args, "request", "") or ""
    candidates: list[dict[str, object]] = []
    original_source: str | None = None
    if task_type in {"repair", "validate"}:
        original_source = source
        candidates.append(
            {
                "origin": "input",
                "source": source,
                "source_sha256": _sha256(source),
                "validation_status": "not_run",
                "diagnostics": [],
            }
        )

    return {
        "task_type": task_type,
        "request": request,
        "sysml_source": source,
        "original_sysml_source": original_source,
        "candidate_history": candidates,
        "diagnostics": [],
        "validation_metadata": {
            "status": "not_run",
            "validator_revision": None,
            "library_revision": None,
            "source_sha256": None,
            "duration_ms": None,
        },
        "semantic_review": {"status": "not_run"},
        "valid": False,
        "repair_count": 0,
        "validation_count": 0,
        "model_calls": 0,
        "run_status": status,
        "error_message": message,
        "run_timeout_seconds": args.run_timeout_seconds,
        "final_artifact_sha256": None,
        "source_diff": None,
    }


def _sha256(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _positive_finite_seconds(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be a number") from exc
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("value must be finite and positive")
    return value


def _add_timeout_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--run-timeout-seconds",
        type=_positive_finite_seconds,
        default=DEFAULT_RUN_TIMEOUT_SECONDS,
        help=(
            "Overall run deadline "
            f"(default: {DEFAULT_RUN_TIMEOUT_SECONDS:g}s)."
        ),
    )
    parser.add_argument(
        "--validator-timeout-seconds",
        type=_positive_finite_seconds,
        default=None,
        help=(
            "Per-call validator deadline; defaults to "
            "SYSML_AGENT_VALIDATOR_TIMEOUT_SECONDS or 60s."
        ),
    )


def _exit_code(status: str) -> int:
    if status == "succeeded":
        return 0
    if status in {"invalid", "repair_exhausted"}:
        return 1
    if status == "cancelled":
        return 130
    return 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run the Phase 3 SysML generate/validate/repair workflow."
        )
    )
    subparsers = parser.add_subparsers(
        dest="task_type",
        required=True,
    )

    generate = subparsers.add_parser(
        "generate",
        help="Generate SysML, validate it, and repair if needed.",
    )
    generate.add_argument("request")
    generate.add_argument(
        "--max-repairs",
        type=int,
        default=3,
    )
    _add_timeout_arguments(generate)

    repair = subparsers.add_parser(
        "repair",
        help="Validate existing SysML first, then repair if needed.",
    )
    repair.add_argument(
        "--file",
        required=True,
    )
    repair.add_argument(
        "--request",
        default="",
    )
    repair.add_argument(
        "--max-repairs",
        type=int,
        default=3,
    )
    _add_timeout_arguments(repair)

    validate = subparsers.add_parser(
        "validate",
        help="Validate SysML without any LLM configuration.",
    )
    validate.add_argument(
        "--file",
        required=True,
    )
    validate.add_argument(
        "--max-repairs",
        type=int,
        default=0,
    )
    _add_timeout_arguments(validate)

    return parser


def main() -> None:
    args = _parser().parse_args()
    try:
        exit_code = asyncio.run(_run(args))
    except KeyboardInterrupt:
        result = _error_result(
            args,
            "",
            status="cancelled",
            message="Run was cancelled by the user.",
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        exit_code = 130
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
