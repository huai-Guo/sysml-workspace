from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SessionInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(default="新会话", min_length=1, max_length=200)
    memory_enabled: bool = True


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    access_token: str = Field(min_length=1, max_length=100)


class DraftInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    task: Literal["generate", "revise", "repair", "validate", "extract", "render"] = "generate"
    request: str = Field(default="", max_length=12000)
    sysml_source: str = Field(default="", max_length=100000)
    render: bool = True
    revision: int | None = None

    @model_validator(mode="after")
    def bounded_source(self):
        if len(self.sysml_source.encode()) > 128 * 1024:
            raise ValueError("Source exceeds 128 KiB")
        return self


class SessionUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    revision: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    memory_enabled: bool | None = None
    draft: DraftInput | None = None

    @model_validator(mode="after")
    def title_not_blank(self):
        if self.title is not None:
            self.title = self.title.strip()
            if not self.title:
                raise ValueError("Title must not be blank")
        return self


class RunInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_id: UUID
    task: Literal["generate", "revise", "repair", "validate", "extract", "render"] = "generate"
    request: str = Field(default="", max_length=12000)
    sysml_source: str = Field(default="", max_length=100000)
    render: bool = False
    root_id: str | None = Field(default=None, max_length=256)
    revision: int | None = None

    @model_validator(mode="after")
    def validate_input(self):
        if self.task in {"generate", "revise"} and not self.request.strip():
            raise ValueError("Generation requires an engineering request")
        if self.task != "generate" and not self.sysml_source.strip():
            raise ValueError("This task requires SysML source")
        if self.task == "generate" and self.sysml_source:
            raise ValueError("Use revise to change existing SysML source")
        if len(self.sysml_source.encode()) > 128 * 1024:
            raise ValueError("Source exceeds 128 KiB")
        return self


class KnowledgeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    source_uri: str = Field(default="user-upload", max_length=1000)
    content: str = Field(min_length=1, max_length=32768)

    @model_validator(mode="after")
    def bounded(self):
        if len(self.content.encode()) > 32768:
            raise ValueError("Document exceeds 32 KiB")
        return self


def public_job(row: dict, *, include_result: bool = True) -> dict:
    result = {
        key: row.get(key)
        for key in (
            "id",
            "session_id",
            "status",
            "error_code",
            "created_at",
            "updated_at",
            "attempts",
            "started_at",
            "phase",
            "phase_updated_at",
            "events",
            "paid_attempts",
        )
    }
    payload = row.get("request") or {}
    result["task"] = payload.get("task", row.get("task", "validate"))
    result["request_preview"] = (payload.get("request") or row.get("request_preview") or "")[:160]
    if include_result:
        result["result"] = row.get("result")
        result["input"] = payload
    return result
