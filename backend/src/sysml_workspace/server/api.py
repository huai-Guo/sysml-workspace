from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from importlib.resources import files
from uuid import UUID

import httpx
import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, Response
from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest
from psycopg_pool import PoolTimeout, TooManyRequests
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .contracts import KnowledgeInput, LoginInput, RunInput, SessionInput, SessionUpdate, public_job
from .database import Database, Owner, ServiceError
from .local_db import LocalDatabase
from .pagination import decode_cursor, encode_cursor
from .resilience import ComponentClient
from .settings import Settings

log = logging.getLogger("sysml_workspace.server")
BODY_TIMEOUT_SECONDS = 10
COOKIE_NAME = "sma_session"


def csrf_value(session: str) -> str:
    return hashlib.sha256(("sysml-csrf:" + session).encode()).hexdigest()


def create_app(settings: Settings | None = None, database: Database | None = None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        if database is not None:
            app.state.db = database
        else:
            try:
                if settings.database_url and "postgresql" in settings.database_url:
                    app.state.db = Database(settings)
                    await asyncio.to_thread(app.state.db.readiness)
                else:
                    raise RuntimeError("No PostgreSQL database configured")
            except Exception as exc:
                log.info(f"Using zero-config LocalDatabase: {exc}")
                from .local_executor import LocalExecutor
                app.state.db = LocalDatabase(settings=settings)
                app.state.executor = LocalExecutor(app.state.db)

        if not hasattr(app.state, "executor") and isinstance(app.state.db, LocalDatabase):
            from .local_executor import LocalExecutor
            app.state.executor = LocalExecutor(app.state.db)

        warmup_task: asyncio.Task[None] | None = None
        if hasattr(app.state, "executor") and hasattr(app.state.executor, "warmup"):
            warmup_task = asyncio.create_task(app.state.executor.warmup())

        # Migrations are an explicit deployment step, never inferred on startup.
        app.state.components = ComponentClient()
        try:
            yield
        finally:
            if warmup_task is not None and not warmup_task.done():
                warmup_task.cancel()
            if hasattr(app.state, "executor") and hasattr(app.state.executor, "validator"):
                aclose = getattr(app.state.executor.validator, "aclose", None)
                if callable(aclose):
                    await aclose()
            await app.state.components.close()
            if database is None:
                app.state.db.close()

    app = FastAPI(
        title="SysML Agent",
        version="1.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
    registry = CollectorRegistry()
    requests = Counter(
        "sysml_http_requests_total",
        "HTTP requests",
        ["method", "route", "status"],
        registry=registry,
    )
    latency = Histogram(
        "sysml_http_seconds", "HTTP latency", ["route", "status"], registry=registry
    )

    def db(request: Request) -> Database:
        return request.app.state.db

    def check_origin(request: Request):
        expected = settings.browser_origin.rstrip("/") or str(request.base_url).rstrip("/")
        if request.headers.get("origin") != expected:
            raise ServiceError(403, "origin_rejected")

    def owner(
        request: Request, authorization: str = Header(default=""), database: Database = Depends(db)
    ) -> Owner:
        if isinstance(database, LocalDatabase):
            return Owner("workspace", "developer")
        if authorization:
            if not authorization.startswith("Bearer ") or len(authorization) > 200:
                raise ServiceError(401, "invalid_credentials")
            return database.authenticate(authorization[7:])
        session = request.cookies.get(COOKIE_NAME, "")
        principal = database.authenticate_browser(session)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            check_origin(request)
            if not secrets.compare_digest(
                request.headers.get("x-csrf-token", ""), csrf_value(session)
            ):
                raise ServiceError(403, "csrf_rejected")
        return principal

    @app.exception_handler(ServiceError)
    async def service_error(request, exc):
        headers = {"Retry-After": "10"} if exc.status in {429, 503} else {}
        if exc.status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(
            {"error": exc.code, "request_id": request.state.request_id},
            status_code=exc.status,
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # FastAPI's default includes the rejected input, potentially full source or credentials.
        return JSONResponse(
            {
                "error": "invalid_request",
                "request_id": request.state.request_id,
                "fields": [list(e["loc"]) for e in exc.errors()],
            },
            status_code=422,
        )

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        nonce = secrets.token_urlsafe(18)
        request.state.csp_nonce = nonce
        started = time.monotonic()
        body = bytearray()
        response = None
        try:
            async with asyncio.timeout(BODY_TIMEOUT_SECONDS):
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > 256 * 1024:
                        response = JSONResponse(
                            {"error": "request_too_large", "request_id": request_id},
                            status_code=413,
                        )
                        break
        except TimeoutError:
            response = JSONResponse(
                {"error": "request_timeout", "request_id": request_id}, status_code=408
            )
        request._body = bytes(body)
        try:
            if response is None:
                response = await call_next(request)
        except (psycopg.Error, PoolTimeout, TooManyRequests):
            response = JSONResponse(
                {"error": "storage_unavailable", "request_id": request_id},
                status_code=503,
                headers={"Retry-After": "10"},
            )
        except Exception as exc:
            log.exception(f"Internal error on {request.url.path}: {exc}")
            log.error(json.dumps({"event": "internal_error", "request_id": request_id}))
            response = JSONResponse(
                {"error": "internal_error", "request_id": request_id}, status_code=500
            )
        response.headers.update(
            {
                "X-Request-ID": request_id,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Content-Security-Policy": f"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            }
        )
        route = getattr(request.scope.get("route"), "path", "unmatched")
        requests.labels(request.method, route, str(response.status_code)).inc()
        latency.labels(route, str(response.status_code)).observe(time.monotonic() - started)
        log.info(
            json.dumps(
                {
                    "event": "http_request",
                    "request_id": request_id,
                    "route": route,
                    "method": request.method,
                    "status": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                }
            )
        )
        return response

    @app.post("/v1/auth/login")
    def login(
        value: LoginInput, request: Request, response: Response, database: Database = Depends(db)
    ):
        check_origin(request)
        secure = (settings.browser_origin or str(request.base_url)).startswith("https://")
        if not secure and request.url.hostname not in {
            "localhost",
            "127.0.0.1",
            "::1",
            "testserver",
        }:
            raise ServiceError(503, "https_required")
        cookie, principal, expiry = database.create_browser_session(value.access_token)
        response.set_cookie(
            COOKIE_NAME,
            cookie,
            httponly=True,
            secure=secure,
            samesite="strict",
            max_age=settings.browser_session_hours * 3600,
            path="/",
        )
        return {
            "tenant_id": principal.tenant_id,
            "user_id": principal.user_id,
            "csrf_token": csrf_value(cookie),
            "expires_at": expiry,
        }

    @app.get("/v1/auth/session")
    def auth_session(request: Request, principal: Owner = Depends(owner)):
        cookie = request.cookies.get(COOKIE_NAME, "local-session")
        return {
            "tenant_id": principal.tenant_id,
            "user_id": principal.user_id,
            "csrf_token": csrf_value(cookie),
        }

    @app.post("/v1/auth/logout", status_code=204)
    def logout(
        request: Request, principal: Owner = Depends(owner), database: Database = Depends(db)
    ):
        database.revoke_browser_session(request.cookies.get(COOKIE_NAME, ""))
        response = Response(status_code=204)
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready(database: Database = Depends(db)):
        state = database.readiness()
        if not state["workers"]:
            return JSONResponse({"status": "unavailable", "reason": "no_workers"}, status_code=503)
        return {"status": "ok"}

    @app.get("/v1/capabilities")
    def capabilities(principal: Owner = Depends(owner), database: Database = Depends(db)):
        return database.readiness()

    @app.get("/v1/me")
    def me(principal: Owner = Depends(owner)):
        return {"tenant_id": principal.tenant_id, "user_id": principal.user_id}

    @app.get("/v1/sessions")
    def sessions(principal: Owner = Depends(owner), database: Database = Depends(db)):
        return {"items": database.list_sessions(principal)}

    @app.post("/v1/sessions", status_code=201)
    def create_session(
        value: SessionInput, principal: Owner = Depends(owner), database: Database = Depends(db)
    ):
        return database.create_session(principal, value.title, value.memory_enabled)

    @app.get("/v1/sessions/{session_id}")
    def session(
        session_id: UUID, principal: Owner = Depends(owner), database: Database = Depends(db)
    ):
        return database.get_session(principal, session_id)

    @app.patch("/v1/sessions/{session_id}")
    def update_session(
        session_id: UUID,
        value: SessionUpdate,
        principal: Owner = Depends(owner),
        database: Database = Depends(db),
    ):
        return database.update_session(principal, session_id, value.model_dump(exclude_none=True))

    @app.delete("/v1/sessions/{session_id}", status_code=204)
    def delete_session(
        session_id: UUID, principal: Owner = Depends(owner), database: Database = Depends(db)
    ):
        database.delete_session(principal, session_id)
        return Response(status_code=204)

    @app.get("/v1/sessions/{session_id}/runs")
    def session_runs(
        session_id: UUID,
        limit: int = Query(default=30, ge=1, le=100),
        cursor: str | None = Query(default=None, max_length=200),
        principal: Owner = Depends(owner),
        database: Database = Depends(db),
    ):
        rows = database.list_jobs(
            principal, session_id, limit=limit + 1, before=decode_cursor(cursor)
        )
        return {
            "items": [public_job(r, include_result=False) for r in rows[:limit]],
            "next_cursor": encode_cursor(rows[limit - 1]) if len(rows) > limit else None,
        }

    @app.post("/v1/runs", status_code=202)
    async def submit(
        value: RunInput,
        response: Response,
        idempotency_key: str = Header(default=""),
        principal: Owner = Depends(owner),
        database: Database = Depends(db),
    ):
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", idempotency_key):
            raise ServiceError(400, "idempotency_key_required")
        payload = value.model_dump(mode="json")
        row, created = database.submit(principal, payload, idempotency_key)
        if hasattr(app.state, "executor"):
            app.state.executor.start_job(row["id"], payload)
        response.status_code = 202 if created else 200
        response.headers["Location"] = f"/v1/runs/{row['id']}"
        return public_job(row)

    @app.get("/v1/runs/{run_id}")
    def run(run_id: UUID, principal: Owner = Depends(owner), database: Database = Depends(db)):
        return public_job(database.get_job(principal, run_id))

    @app.get("/v1/runs/{run_id}/status")
    def run_status(
        run_id: UUID, principal: Owner = Depends(owner), database: Database = Depends(db)
    ):
        return public_job(database.get_job(principal, run_id, summary=True), include_result=False)

    @app.post("/v1/runs/{run_id}/cancel", status_code=204)
    def cancel(run_id: UUID, principal: Owner = Depends(owner), database: Database = Depends(db)):
        database.cancel(principal, run_id)
        return Response(status_code=204)

    @app.get("/v1/runs/{run_id}/artifacts/{artifact}")
    def artifact(
        run_id: UUID,
        artifact: str,
        principal: Owner = Depends(owner),
        database: Database = Depends(db),
    ):
        row = database.get_job(principal, run_id)
        result = row["result"] or {}
        if row["status"] not in {"succeeded", "failed"} or not result.get("valid"):
            raise ServiceError(409, "artifact_not_ready")
        if artifact == "model.sysml" and result.get("valid"):
            content, media = result["sysml_source"], "text/plain; charset=utf-8"
        elif artifact == "entities.json" and result.get("semantic_model"):
            content = json.dumps(
                {"source_sha256": result["final_artifact_sha256"], **result["semantic_model"]},
                ensure_ascii=False,
            )
            media = "application/json"
        elif artifact == "diagram.svg" and result.get("diagram"):
            content, media = result["diagram"]["svg"], "image/svg+xml"
        else:
            raise ServiceError(404, "artifact_not_found")
        return Response(
            content,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{artifact}"'},
        )

    @app.get("/metrics")
    def metrics(authorization: str = Header(default=""), database: Database = Depends(db)):
        if len(settings.metrics_token) < 32 or not secrets.compare_digest(
            authorization, "Bearer " + settings.metrics_token
        ):
            raise ServiceError(401, "invalid_credentials")
        extra = "\n".join(
            f'sysml_jobs{{status="{status}"}} {count}'
            for status, count in database.counts().items()
        )
        extra += "\n" + "\n".join(
            f"sysml_{name} {value}" for name, value in database.operational_metrics().items()
        )
        extra += f"\nsysml_execution_capacity {settings.global_concurrency}\nsysml_queue_capacity {settings.max_pending}"
        return Response(
            generate_latest(registry) + extra.encode() + b"\n",
            media_type="text/plain; version=0.0.4",
        )

    @app.get("/v1/openapi.json")
    def schema(principal: Owner = Depends(owner)):
        return app.openapi()

    async def knowledge_call(
        request: Request, path: str, principal: Owner, payload: dict | None = None
    ):
        if not settings.rag_url or not settings.rag_token:
            raise ServiceError(503, "knowledge_not_configured")
        try:
            status, data = await request.app.state.components.request(
                "rag",
                settings.rag_url.rstrip("/") + path,
                settings.rag_token,
                payload={
                    "tenant_id": principal.tenant_id,
                    "user_id": principal.user_id,
                    **(payload or {}),
                },
                accepted=(200, 404, 429),
            )
            if status in {404, 429}:
                raise ServiceError(
                    status,
                    "knowledge_not_found" if status == 404 else "knowledge_quota_exceeded",
                )
            return data
        except (httpx.HTTPError, ValueError, RuntimeError, TimeoutError) as exc:
            raise ServiceError(503, "knowledge_unavailable") from exc

    @app.get("/v1/knowledge")
    async def knowledge_list(request: Request, principal: Owner = Depends(owner)):
        return await knowledge_call(request, "/v1/documents/list", principal)

    @app.put("/v1/knowledge/{document_id}")
    async def knowledge_put(
        document_id: str, value: KnowledgeInput, request: Request, principal: Owner = Depends(owner)
    ):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", document_id):
            raise ServiceError(400, "invalid_document_id")
        return await knowledge_call(
            request,
            "/v1/documents",
            principal,
            {"document": {"id": document_id, **value.model_dump()}},
        )

    @app.delete("/v1/knowledge/{document_id}")
    async def knowledge_delete(
        document_id: str, request: Request, principal: Owner = Depends(owner)
    ):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", document_id):
            raise ServiceError(400, "invalid_document_id")
        return await knowledge_call(request, f"/v1/documents/{document_id}/delete", principal)

    @app.get("/")
    def index(request: Request):
        content = (
            files("sysml_workspace.server")
            .joinpath("static/index.html")
            .read_text(encoding="utf-8")
            .replace("__CSP_NONCE__", request.state.csp_nonce)
        )
        response = HTMLResponse(content)
        if isinstance(request.app.state.db, LocalDatabase):
            response.set_cookie(
                COOKIE_NAME,
                "local-session",
                max_age=86400 * 30,
                httponly=True,
                samesite="lax",
                path="/",
            )
        return response

    @app.get("/assets/{name}")
    def asset(name: str):
        media = {
            "workbench.js": "text/javascript",
            "workbench.css": "text/css",
        }.get(name)
        if media is None:
            raise HTTPException(404)
        return Response(
            files("sysml_workspace.server").joinpath("static", "dist", name).read_bytes(),
            media_type=media,
        )

    return app
