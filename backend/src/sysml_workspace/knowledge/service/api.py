import asyncio
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .retrieval import retrieve
from .store import Store


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(pattern=r"^[A-Za-z0-9_.@-]{1,100}$")
    user_id: str = Field(pattern=r"^[A-Za-z0-9_.@-]{1,100}$")


class Document(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,100}$")
    title: str = Field(min_length=1, max_length=200)
    source_uri: str = Field(default="user-upload", max_length=1000)
    content: str = Field(min_length=1, max_length=32768)

    @model_validator(mode="after")
    def size(self):
        if len(self.content.encode()) > 32768:
            raise ValueError("Document exceeds 32 KiB")
        return self


class PutRequest(Scope):
    document: Document


class Query(Scope):
    query: str = Field(min_length=1, max_length=12000)


@asynccontextmanager
async def lifespan(app):
    token = os.getenv("RAG_SERVICE_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("RAG_SERVICE_TOKEN must be at least 32 characters")
    app.state.token = token
    app.state.store = Store(os.environ["RAG_DATABASE_URL"], int(os.getenv("RAG_RETENTION_DAYS", "30")))
    yield
    app.state.store.pool.close()


app = FastAPI(title="Scoped SysML evidence service", lifespan=lifespan, docs_url=None, redoc_url=None)


async def authorized(request: Request, authorization: str = Header(default="")):
    if not secrets.compare_digest(authorization, "Bearer " + request.app.state.token):
        raise HTTPException(401, "Service authentication required")


@app.middleware("http")
async def bound_request(request: Request, call_next):
    body = bytearray()
    try:
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 256 * 1024:
                    return JSONResponse({"error": "request_too_large"}, status_code=413)
    except TimeoutError:
        return JSONResponse({"error": "request_timeout"}, status_code=408)
    request._body = bytes(body)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready", dependencies=[Depends(authorized)])
def ready(request: Request):
    try:
        request.app.state.store.readiness()
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return {"status": "ready"}


@app.post("/v1/retrieve", dependencies=[Depends(authorized)])
def query(value: Query, request: Request):
    return retrieve(value.query, request.app.state.store.documents(value))


@app.post("/v1/documents", dependencies=[Depends(authorized)])
def put(value: PutRequest, request: Request):
    try:
        return request.app.state.store.put(value, value.document)
    except ValueError as exc:
        raise HTTPException(429, "document_quota_exceeded") from exc


@app.post("/v1/documents/list", dependencies=[Depends(authorized)])
def list_documents(value: Scope, request: Request):
    return {"items": [{k: v for k, v in d.items() if k != "content"} for d in request.app.state.store.documents(value)]}


@app.post("/v1/documents/{document_id}/delete", dependencies=[Depends(authorized)])
def delete(document_id: str, value: Scope, request: Request):
    if not request.app.state.store.delete(value, document_id):
        raise HTTPException(404, "document_not_found")
    return {"deleted": True}
