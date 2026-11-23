from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import signal
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from .contracts import SysMLDiagnostic, SysMLValidationResult
from .validator import (
    SysMLValidator,
    SysMLValidatorError,
    SysMLValidatorTimeoutError,
)


class PilotSubprocessValidator(SysMLValidator):
    """Call the pinned OMG Pilot wrapper as a bounded subprocess."""

    def __init__(
        self,
        tooling_dir: str | Path | None = None,
        *,
        timeout_seconds: float | None = None,
    ) -> None:
        self._tooling_dir = (
            Path(tooling_dir)
            if tooling_dir is not None
            else _default_tooling_dir()
        ).resolve()
        self._timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else _validator_timeout_from_env()
        )
        if (
            not math.isfinite(self._timeout_seconds)
            or self._timeout_seconds <= 0
        ):
            raise ValueError("timeout_seconds must be a finite positive number.")

    async def validate(self, source: str) -> SysMLValidationResult:
        if not source.strip():
            source_bytes = source.encode("utf-8")
            return SysMLValidationResult(
                valid=False,
                diagnostics=(
                    SysMLDiagnostic(
                        severity="error",
                        kind="syntax",
                        message="SysML source is empty.",
                        source="sysml-agent-validator",
                    ),
                ),
                source_sha256=hashlib.sha256(source_bytes).hexdigest(),
                duration_ms=0.0,
            )

        started_at = time.perf_counter()
        source_bytes = source.encode("utf-8")
        if len(source_bytes) > 128 * 1024:
            raise SysMLValidatorError("SysML source exceeds the 128 KiB limit.")
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        fd, temp_name = tempfile.mkstemp(
            prefix="sysml-agent-",
            suffix=".sysml",
        )
        os.close(fd)
        temp_path = Path(temp_name)
        process: asyncio.subprocess.Process | None = None

        try:
            # Write the exact UTF-8 bytes whose hash is returned to the caller.
            temp_path.write_bytes(source_bytes)
            process_options = {}
            if os.name != "nt":
                process_options["start_new_session"] = True
            process = await asyncio.create_subprocess_exec(
                *self._command(temp_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **process_options,
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    _bounded_output(process),
                    timeout=self._timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                await _terminate_process(process)
                raise SysMLValidatorTimeoutError(
                    "OMG Pilot validator exceeded its "
                    f"{self._timeout_seconds:g}s per-call timeout."
                ) from exc
            except asyncio.CancelledError:
                await _terminate_process(process)
                raise

            stdout = stdout_bytes.decode(
                "utf-8",
                errors="replace",
            ).strip()
            stderr = stderr_bytes.decode(
                "utf-8",
                errors="replace",
            ).strip()

            if process.returncode not in {0, 1}:
                raise SysMLValidatorError(
                    f"OMG Pilot validator failed with exit code {process.returncode}."
                )

            revisions = _load_validator_revisions(self._tooling_dir)
            duration_ms = (time.perf_counter() - started_at) * 1000
            result = parse_validation_payload(
                stdout,
                validator_revision=revisions[0],
                library_revision=revisions[1],
                source_sha256=source_sha256,
                duration_ms=duration_ms,
            )
            expected_exit_code = 0 if result.valid else 1
            if process.returncode != expected_exit_code:
                raise SysMLValidatorError(
                    "OMG Pilot exit code does not match its JSON result: "
                    f"exit={process.returncode}, valid={result.valid}."
                )
            return result
        finally:
            if process is not None and process.returncode is None:
                await _terminate_process(process)
            temp_path.unlink(missing_ok=True)

    def _command(self, source_path: Path) -> list[str]:
        # Execute Java directly so timeout/cancellation always owns the JVM.
        bundle = self._tooling_dir.parent.parent / ".tools" / "sysml-pilot-0.62.0" / "sysml"
        classes = self._tooling_dir / "build" / "classes"
        jars = sorted(bundle.glob("jupyter-sysml-kernel-*-all.jar"))
        executable = shutil.which("java")
        if not executable or not jars or not classes.is_dir() or not (bundle / "sysml.library").is_dir():
            raise SysMLValidatorError("Pilot runtime is unavailable; run the validator bootstrap first.")
        return [executable, "-Xmx512m", "-XX:MaxMetaspaceSize=256m", "-XX:+ExitOnOutOfMemoryError",
                "-Dfile.encoding=UTF-8", "-cp", os.pathsep.join((str(classes), str(jars[0]))),
                "io.github.huaiguo.sysmlvalidator.ValidatorMain", "--library",
                str(bundle / "sysml.library"), "--file", str(source_path)]


def parse_validation_payload(
    raw: str,
    *,
    validator_revision: str | None = None,
    library_revision: str | None = None,
    source_sha256: str | None = None,
    duration_ms: float | None = None,
) -> SysMLValidationResult:
    if not raw:
        raise SysMLValidatorError(
            "Validator returned empty stdout."
        )

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SysMLValidatorError(
            f"Validator stdout was not JSON: {raw[:500]}"
        ) from exc

    if not isinstance(payload, dict):
        raise SysMLValidatorError(
            "Validator JSON payload must be an object."
        )

    diagnostics_raw = payload.get("diagnostics")
    if not isinstance(diagnostics_raw, list):
        raise SysMLValidatorError(
            "Validator diagnostics must be a list."
        )

    diagnostics = tuple(
        _parse_diagnostic(item)
        for item in diagnostics_raw
    )
    validator = payload.get("validator")
    validator = (
        validator
        if isinstance(validator, dict)
        else {}
    )

    valid = payload.get("valid")
    if not isinstance(valid, bool):
        raise SysMLValidatorError(
            "Validator payload is missing boolean valid."
        )
    if any(d.kind == "internal" for d in diagnostics):
        raise SysMLValidatorError("Validator reported an internal failure.")
    if valid and any(d.severity == "error" for d in diagnostics):
        raise SysMLValidatorError("Validator success contradicts error diagnostics.")
    model = payload.get("model")
    if model is not None and (not valid or not isinstance(model, dict)
            or model.get("schema_version") != "1" or not isinstance(model.get("entities"), list)
            or not isinstance(model.get("relations"), list)):
        raise SysMLValidatorError("Invalid semantic model payload.")

    return SysMLValidationResult(
        valid=valid,
        diagnostics=diagnostics,
        validator_name=_optional_str(
            validator.get("name")
        ),
        validator_version=_optional_str(
            validator.get("version")
        ),
        validator_tag=_optional_str(
            validator.get("tag")
        ),
        validator_revision=validator_revision,
        library_revision=library_revision,
        source_sha256=source_sha256,
        duration_ms=duration_ms,
        semantic_model=model,
    )


async def _bounded_output(process: asyncio.subprocess.Process) -> tuple[bytes, bytes]:
    async def read(stream, limit):
        chunks = bytearray()
        while block := await stream.read(65536):
            chunks.extend(block)
            if len(chunks) > limit:
                raise SysMLValidatorError("Validator output exceeds its size limit.")
        return bytes(chunks)
    readers = [asyncio.create_task(read(process.stdout, 4 * 1024 * 1024)),
               asyncio.create_task(read(process.stderr, 512 * 1024))]
    try:
        stdout, stderr = await asyncio.gather(*readers)
        await process.wait()
        return stdout, stderr
    finally:
        for reader in readers:
            reader.cancel()
        await asyncio.gather(*readers, return_exceptions=True)


def _parse_diagnostic(value: Any) -> SysMLDiagnostic:
    if not isinstance(value, dict):
        raise SysMLValidatorError(
            "Validator diagnostic must be an object."
        )

    severity = value.get("severity")
    kind = value.get("kind")
    message = value.get("message")

    if severity not in {
        "error",
        "warning",
        "info",
        "ignore",
    }:
        raise SysMLValidatorError(
            f"Unsupported diagnostic severity: {severity}"
        )
    if kind not in {
        "syntax",
        "semantic",
        "internal",
    }:
        raise SysMLValidatorError(
            f"Unsupported diagnostic kind: {kind}"
        )
    if not isinstance(message, str):
        raise SysMLValidatorError(
            "Diagnostic message must be a string."
        )

    return SysMLDiagnostic(
        severity=severity,
        kind=kind,
        message=message,
        line=_optional_int(value.get("line")),
        column=_optional_int(value.get("column")),
        offset=_optional_int(value.get("offset")),
        length=_optional_int(value.get("length")),
        code=_optional_str(value.get("code")),
        source=(
            _optional_str(value.get("source"))
            or "omg-pilot"
        ),
    )


def _default_tooling_dir() -> Path:
    configured = os.getenv(
        "SYSML_AGENT_VALIDATOR_DIR"
    )
    if configured:
        return Path(configured)

    candidate = (
        Path.cwd()
        / "tooling"
        / "sysml-validator"
    )
    if candidate.exists():
        return candidate

    raise SysMLValidatorError(
        "Validator tooling directory was not found. "
        "Run from the repository root or set "
        "SYSML_AGENT_VALIDATOR_DIR."
    )


def _validator_timeout_from_env() -> float:
    raw = os.getenv("SYSML_AGENT_VALIDATOR_TIMEOUT_SECONDS", "60")
    try:
        timeout_seconds = float(raw)
    except ValueError as exc:
        raise ValueError(
            "SYSML_AGENT_VALIDATOR_TIMEOUT_SECONDS must be numeric."
        ) from exc
    return timeout_seconds


def _load_validator_revisions(tooling_dir: Path) -> tuple[str, str]:
    lock_path = tooling_dir / "upstream.lock.json"
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SysMLValidatorError(
            f"Could not read pinned validator metadata: {lock_path}"
        ) from exc

    if not isinstance(lock, dict):
        raise SysMLValidatorError(
            "Pinned validator metadata must be a JSON object."
        )
    validator_revision = _optional_str(lock.get("commit"))
    library_revision = _optional_str(
        lock.get("libraryCommit") or lock.get("commit")
    )
    if not validator_revision or not library_revision:
        raise SysMLValidatorError(
            "Pinned validator metadata is missing validator/library revisions."
        )
    return validator_revision, library_revision


async def _terminate_process(
    process: asyncio.subprocess.Process,
) -> None:
    if process.returncode is not None:
        return
    if os.name == "nt":
        taskkill = shutil.which("taskkill")
        if taskkill:
            try:
                killer = await asyncio.create_subprocess_exec(
                    taskkill,
                    "/PID",
                    str(process.pid),
                    "/T",
                    "/F",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await killer.wait()
            except OSError:
                pass
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    if process.returncode is None:
        try:
            process.kill()
        except ProcessLookupError:
            pass
    await process.wait()


def _optional_int(value: Any) -> int | None:
    return value if type(value) is int else None


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None
