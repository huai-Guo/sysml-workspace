from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from sysml_workspace.agent.workflow import (
    DEFAULT_RUN_TIMEOUT_SECONDS,
    build_sysml_graph,
)
from sysml_workspace.agent.models import (
    ModelGatewayConfig,
    create_model_gateway,
)
from sysml_workspace.agent.models.errors import ModelConfigurationError
from sysml_workspace.parser import PilotSubprocessValidator

_WEB_DIR = Path(__file__).resolve().parent
_MAX_BODY_BYTES = 128 * 1024
_MAX_REQUEST_CHARS = 20_000
_DEFAULT_MAX_REPAIRS = 3


def _tooling_dir() -> Path:
    configured = os.getenv("SYSML_AGENT_VALIDATOR_DIR")
    if configured:
        return Path(configured).resolve()

    current = Path.cwd() / "tooling" / "sysml-validator"
    if current.is_dir():
        return current.resolve()
    return (_WEB_DIR.parents[2] / "tooling" / "sysml-validator").resolve()


def _readiness() -> dict[str, object]:
    raw_provider = os.getenv("SYSML_AGENT_MODEL_PROVIDER", "").strip()
    raw_model = os.getenv("SYSML_AGENT_MODEL_NAME", "").strip()
    missing: list[str] = []
    if raw_provider not in {"openai", "anthropic", "openai_compatible", "ollama"}:
        missing.append(
            "SYSML_AGENT_MODEL_PROVIDER（openai / anthropic / openai_compatible / ollama）"
        )
    if not raw_model:
        missing.append("SYSML_AGENT_MODEL_NAME")
    if raw_provider == "openai" and not (
        os.getenv("SYSML_AGENT_MODEL_API_KEY") or os.getenv("OPENAI_API_KEY")
    ):
        missing.append("SYSML_AGENT_MODEL_API_KEY 或 OPENAI_API_KEY")
    elif raw_provider == "anthropic" and not (
        os.getenv("SYSML_AGENT_MODEL_API_KEY")
        or os.getenv("ANTHROPIC_API_KEY")
    ):
        missing.append("SYSML_AGENT_MODEL_API_KEY 或 ANTHROPIC_API_KEY")
    elif raw_provider == "openai_compatible" and not os.getenv(
        "SYSML_AGENT_MODEL_BASE_URL"
    ):
        missing.append("SYSML_AGENT_MODEL_BASE_URL")

    model: dict[str, object] = {
        "configured": False,
        "provider": raw_provider or None,
        "model": raw_model or None,
        "missing": missing,
    }
    if not missing:
        try:
            config = ModelGatewayConfig.from_env()
            model["provider"] = config.provider
            model["model"] = config.model
            model["configured"] = True
        except ModelConfigurationError as exc:
            model["missing"] = [str(exc)]

    tooling_dir = _tooling_dir()
    repo_root = tooling_dir.parent.parent
    validator_bundle = repo_root / ".tools" / "sysml-pilot-0.62.0" / "sysml"
    checks = {
        "validate.ps1": (tooling_dir / "validate.ps1").is_file(),
        "upstream.lock.json": (tooling_dir / "upstream.lock.json").is_file(),
        "编译后的验证器": (tooling_dir / "build" / "classes").is_dir(),
        "Pilot 运行包": any(
            validator_bundle.glob("jupyter-sysml-kernel-*-all.jar")
        ),
        "SysML 标准库": (validator_bundle / "sysml.library").is_dir(),
        "Java": shutil.which("java") is not None,
        "PowerShell": (
            shutil.which("pwsh") is not None
            or shutil.which("powershell") is not None
        ),
    }
    return {
        "model": model,
        "validator": {
            "ready": all(checks.values()),
            "missing": [name for name, ready in checks.items() if not ready],
        },
    }


async def _run_generation(request: str) -> dict[str, object]:
    config = ModelGatewayConfig.from_env()
    gateway = create_model_gateway(config)
    try:
        graph = build_sysml_graph(
            model_gateway=gateway,
            validator=PilotSubprocessValidator(tooling_dir=_tooling_dir()),
            default_max_repair_count=_DEFAULT_MAX_REPAIRS,
            default_run_timeout_seconds=DEFAULT_RUN_TIMEOUT_SECONDS,
        )
        result = await graph.ainvoke(
            {
                "task_type": "generate",
                "request": request,
                "max_repair_count": _DEFAULT_MAX_REPAIRS,
                "run_timeout_seconds": DEFAULT_RUN_TIMEOUT_SECONDS,
            }
        )
        return dict(result)
    finally:
        await gateway.aclose()


class _LocalHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class _RequestHandler(BaseHTTPRequestHandler):
    server_version = "SysMLAgentLocal/1.0"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        # Keep the local console useful without logging request bodies or headers.
        path = urlsplit(self.path).path
        print(f"{self.command} {path} -> {args[1] if len(args) > 1 else ''}")

    def _write_json(
        self,
        status: HTTPStatus,
        payload: dict[str, object],
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _write_asset(
        self,
        filename: str,
        content_type: str,
    ) -> None:
        try:
            body = (_WEB_DIR / filename).read_bytes()
        except OSError:
            self._write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "前端资源暂时无法读取。"},
            )
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self' data:; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        )
        self.end_headers()
        self.wfile.write(body)

    def _request_is_local(self) -> bool:
        host_header = self.headers.get("Host", "")
        host = urlsplit(f"//{host_header}")
        if host.hostname not in {"127.0.0.1", "localhost"}:
            return False
        if host.port != self.server.server_port:
            return False

        origin_header = self.headers.get("Origin")
        if origin_header:
            origin = urlsplit(origin_header)
            if (
                origin.scheme != "http"
                or origin.hostname not in {"127.0.0.1", "localhost"}
                or origin.port != self.server.server_port
            ):
                return False
        return True

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if not self._request_is_local():
            self._write_json(HTTPStatus.FORBIDDEN, {"error": "仅允许本机访问。"})
            return

        path = urlsplit(self.path).path
        if path == "/":
            self._write_asset("index.html", "text/html; charset=utf-8")
        elif path == "/app.css":
            self._write_asset("app.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self._write_asset("app.js", "text/javascript; charset=utf-8")
        elif path == "/api/status":
            self._write_json(HTTPStatus.OK, _readiness())
        else:
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "未找到该页面。"})

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if not self._request_is_local():
            self._write_json(HTTPStatus.FORBIDDEN, {"error": "仅允许本机访问。"})
            return
        if urlsplit(self.path).path != "/api/generate":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "未找到该接口。"})
            return
        if self.headers.get_content_type() != "application/json":
            self._write_json(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                {"error": "请求必须使用 application/json。"},
            )
            return

        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = 0
        if length <= 0 or length > _MAX_BODY_BYTES:
            self._write_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "请求内容为空或超出大小限制。"},
            )
            return

        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "请求内容不是有效的 JSON。"},
            )
            return
        request = payload.get("request") if isinstance(payload, dict) else None
        if not isinstance(request, str) or not request.strip():
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "请先填写需求描述。"},
            )
            return
        if len(request) > _MAX_REQUEST_CHARS:
            self._write_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": f"需求描述不能超过 {_MAX_REQUEST_CHARS} 个字符。"},
            )
            return

        readiness = _readiness()
        model = readiness["model"]
        validator = readiness["validator"]
        if not model["configured"]:
            self._write_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "error": "模型尚未配置完整。",
                    "missing": model["missing"],
                },
            )
            return
        if not validator["ready"]:
            self._write_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "error": "SysML 验证器尚未准备好。",
                    "missing": validator["missing"],
                },
            )
            return

        try:
            result = asyncio.run(_run_generation(request.strip()))
        except ModelConfigurationError as exc:
            self._write_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": str(exc)},
            )
            return
        except Exception as exc:
            # Do not return a traceback or environment data to the browser.
            self._write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"本地工作流启动失败：{type(exc).__name__}。"},
            )
            return

        self._write_json(HTTPStatus.OK, result)


def _port_number(raw: str) -> int:
    try:
        port = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("端口必须是整数。") from exc
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError("端口必须在 0 到 65535 之间。")
    return port


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Start the local SysML Agent browser UI (Windows MVP)."
    )
    parser.add_argument("--port", type=_port_number, default=8765)
    args = parser.parse_args()

    try:
        server = _LocalHTTPServer(("127.0.0.1", args.port), _RequestHandler)
    except OSError as exc:
        parser.error(f"无法在本机端口 {args.port} 启动服务：{exc}")

    print(
        f"SysML Agent 本地测试页已启动：http://127.0.0.1:{server.server_port}/"
    )
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止本地服务……")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
