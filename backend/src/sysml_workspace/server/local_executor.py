"""
Local async job executor for SysML Workspace.
Executes SysML generation, validation, repair, and diagram rendering in-process.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path
from typing import Any

from sysml_workspace.agent.models import ModelGatewayConfig, create_model_gateway
from sysml_workspace.agent.workflow import build_sysml_graph
from sysml_workspace.diagram.svg import RenderRequest, SemanticModel, render_svg
from sysml_workspace.parser import PilotSubprocessValidator
from .local_db import LocalDatabase

log = logging.getLogger("sysml_workspace.local_executor")


def _get_tooling_dir() -> Path:
    env_dir = os.getenv("SYSML_AGENT_VALIDATOR_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    base = Path(__file__).resolve().parent.parent.parent.parent
    return (base / "tooling" / "sysml-validator").resolve()


class LocalExecutor:
    def __init__(self, db: LocalDatabase):
        self.db = db
        self.validator = PilotSubprocessValidator(tooling_dir=_get_tooling_dir())

    def start_job(self, job_id: str, payload: dict):
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._run_job(job_id, payload))
        except RuntimeError:
            if hasattr(self, "loop") and self.loop and self.loop.is_running():
                asyncio.run_coroutine_threadsafe(self._run_job(job_id, payload), self.loop)
            else:
                import threading
                threading.Thread(
                    target=lambda: asyncio.run(self._run_job(job_id, payload)),
                    daemon=True,
                ).start()

    async def _run_job(self, job_id: str, payload: dict):
        task = payload.get("task", "validate")
        sysml_source = payload.get("sysml_source", "")
        request_text = payload.get("request", "")
        root_id = payload.get("root_id")

        self.db.update_job_status(job_id, "running", f"processing_{task}")

        try:
            gateway = None
            if task in {"generate", "revise", "repair"}:
                try:
                    config = ModelGatewayConfig.from_env()
                    gateway = create_model_gateway(config)
                except Exception as exc:
                    log.warning(f"Model gateway not configured: {exc}")

            # 1. Validation or generation
            if task in {"generate", "revise", "repair"} and gateway is not None:
                self.db.update_job_status(job_id, "running", "generating_code")
                graph = build_sysml_graph(
                    model_gateway=gateway,
                    validator=self.validator,
                    default_max_repair_count=3,
                )
                state = await graph.ainvoke({
                    "task_type": task,
                    "request": request_text,
                    "sysml_source": sysml_source,
                    "run_timeout_seconds": 180,
                    "max_repair_count": 3,
                })
                result_source = state.get("sysml_source", "")
                is_valid = state.get("valid", False)
                diagnostics = state.get("diagnostics", [])
                semantic_model = state.get("semantic_model")
                run_status = state.get("run_status", "succeeded")
                error_msg = state.get("error_message")
            else:
                self.db.update_job_status(job_id, "running", "validating_sysml")
                validation = await self.validator.validate(sysml_source)
                result_source = sysml_source
                is_valid = validation.valid
                diagnostics = [
                    {
                        "severity": d.severity,
                        "message": d.message,
                        "line": d.line,
                        "column": d.column,
                        "offset": d.offset,
                        "length": d.length,
                    }
                    for d in validation.diagnostics
                ]
                semantic_model = validation.semantic_model
                run_status = "succeeded" if is_valid else "invalid"
                error_msg = None

            # 2. Native Diagram Rendering
            diagram = None
            if semantic_model:
                try:
                    self.db.update_job_status(job_id, "running", "rendering_diagram")
                    sem_obj = SemanticModel.model_validate(semantic_model)
                    source_hash = hashlib.sha256(result_source.encode()).hexdigest()
                    render_req = RenderRequest(
                        source_sha256=source_hash,
                        semantic_model=sem_obj,
                        root_id=root_id,
                    )
                    diagram = render_svg(render_req)
                except Exception as exc:
                    log.warning(f"SVG rendering failed: {exc}")

            final_result = {
                "sysml_source": result_source,
                "final_artifact_sha256": hashlib.sha256(result_source.encode()).hexdigest(),
                "valid": is_valid,
                "diagnostics": diagnostics,
                "semantic_model": semantic_model,
                "diagram": diagram,
                "run_status": run_status,
                "error_message": error_msg,
                "request": request_text,
                "requested_task": task,
                "model_usage": [],
                "entities": semantic_model.get("entities", []) if semantic_model else [],
            }
            job_status = "succeeded" if run_status in {"succeeded", "valid"} or is_valid else "failed"
            self.db.update_job_status(
                job_id,
                job_status,
                "completed" if job_status == "succeeded" else "failed",
                result=final_result,
                error_code=error_msg,
            )

        except Exception as exc:
            log.exception(f"Job {job_id} failed: {exc}")
            self.db.update_job_status(
                job_id,
                "failed",
                "failed",
                result={"run_status": "failed", "error_message": str(exc), "valid": False},
                error_code="execution_failed",
            )
        finally:
            if gateway:
                await gateway.aclose()
