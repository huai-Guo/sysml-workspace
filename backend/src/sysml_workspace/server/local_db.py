"""
SQLite-backed local storage provider for SysML Workspace.
Enables instant zero-config desktop/workbench usage without requiring PostgreSQL.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from .database import Owner, ServiceError
from .settings import Settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


SAMPLE_SYSML = """package ElectricalSystem {
    port def PowerPort;
    port def SignalPort;

    part def Battery {
        port powerOut: PowerPort;
    }

    part def Inverter {
        port powerIn: PowerPort;
        port powerOut: PowerPort;
        port ctrl: SignalPort;
    }

    part def ElectricMotor {
        port powerIn: PowerPort;
    }

    part def Controller {
        port controlSignal: SignalPort;
    }

    part vehicle {
        part b: Battery;
        part inv: Inverter;
        part m: ElectricMotor;
        part c: Controller;

        connection c1 connect b.powerOut to inv.powerIn;
        connection c2 connect inv.powerOut to m.powerIn;
        connection c3 connect c.controlSignal to inv.ctrl;
    }
}
"""


class LocalDatabase:
    """Thread-safe SQLite storage for single-tenant local workspace."""

    def __init__(self, db_path: str | Path | None = None, settings: Settings | None = None):
        if db_path is None:
            db_path = Path.cwd() / "workspace.db"
        self.db_path = str(db_path)
        self.settings = settings or Settings.from_env()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_schema(self):
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    memory_enabled INTEGER NOT NULL DEFAULT 1,
                    sysml_source TEXT NOT NULL DEFAULT '',
                    revision INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    request TEXT NOT NULL,
                    result TEXT,
                    error_code TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS knowledge (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)

            # Create default session if empty
            cur = conn.execute("SELECT count(*) as cnt FROM sessions")
            if cur.fetchone()["cnt"] == 0:
                now = _now()
                sess_id = str(uuid.uuid4())
                conn.execute(
                    """INSERT INTO sessions (id, tenant_id, user_id, title, memory_enabled, sysml_source, revision, created_at, updated_at)
                       VALUES (?, 'workspace', 'developer', '电动汽车动力系统示例', 1, ?, 1, ?, ?)""",
                    (sess_id, SAMPLE_SYSML, now, now),
                )

    def close(self):
        pass

    def readiness(self):
        with self._connect() as conn:
            conn.execute("SELECT 1")
        return {
            "database": True,
            "workers": 1,
            "capabilities": ["generate", "revise", "repair", "validate", "render", "extract", "rag"],
        }

    def authenticate_browser(self, session: str) -> Owner:
        return Owner("workspace", "developer")

    def create_browser_session(self, token: str):
        owner = Owner("workspace", "developer")
        session = secrets.token_urlsafe(32)
        expiry = datetime.now(timezone.utc) + timedelta(days=90)
        return session, owner, expiry

    def revoke_browser_session(self, session: str) -> None:
        pass

    def authenticate(self, token: str) -> Owner:
        return Owner("workspace", "developer")

    def get_owner_from_token(self, token: str) -> Owner:
        return Owner("workspace", "developer")

    def issue_token(self, owner: Owner, label: str, days: int = 90) -> str:
        return "local-dev-token"

    def list_sessions(self, owner: Owner) -> list[dict]:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT id, title, updated_at, revision FROM sessions WHERE tenant_id = ? AND user_id = ? ORDER BY updated_at DESC",
                (owner.tenant_id, owner.user_id),
            )
            return [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "updated_at": row["updated_at"],
                    "revision": row["revision"],
                }
                for row in cur.fetchall()
            ]

    def create_session(self, owner: Owner, title: str, memory_enabled: bool = True) -> dict:
        sess_id = str(uuid.uuid4())
        now = _now()
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO sessions (id, tenant_id, user_id, title, memory_enabled, sysml_source, revision, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)""",
                (sess_id, owner.tenant_id, owner.user_id, title, 1 if memory_enabled else 0, now, now),
            )
        return self.get_session(owner, sess_id)

    def get_session(self, owner: Owner, session_id: str) -> dict:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT * FROM sessions WHERE id = ? AND tenant_id = ? AND user_id = ?",
                (str(session_id), owner.tenant_id, owner.user_id),
            )
            row = cur.fetchone()
            if not row:
                raise ServiceError(404, "session_not_found")
            return {
                "id": row["id"],
                "title": row["title"],
                "memory_enabled": bool(row["memory_enabled"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "draft": {
                    "sysml_source": row["sysml_source"],
                    "revision": row["revision"],
                    "task": "render",
                    "request": "",
                    "render": True,
                },
            }

    def update_session(self, owner: Owner, session_id: str, values: dict) -> dict:
        sess = self.get_session(owner, session_id)
        current_rev = sess["draft"]["revision"]
        expected_rev = values.get("revision")
        if expected_rev is not None and expected_rev != current_rev:
            raise ServiceError(409, "draft_conflict")

        new_rev = current_rev + 1
        draft_val = values.get("draft")
        if isinstance(draft_val, dict):
            source = draft_val.get("sysml_source", sess["draft"]["sysml_source"])
        else:
            source = values.get("sysml_source", sess["draft"]["sysml_source"])
        title = values.get("title", sess["title"])
        memory = 1 if values.get("memory_enabled", sess["memory_enabled"]) else 0
        now = _now()

        with self._connect() as conn:
            conn.execute(
                """UPDATE sessions SET title = ?, memory_enabled = ?, sysml_source = ?, revision = ?, updated_at = ?
                   WHERE id = ? AND tenant_id = ? AND user_id = ?""",
                (title, memory, source, new_rev, now, str(session_id), owner.tenant_id, owner.user_id),
            )
        return self.get_session(owner, session_id)

    def delete_session(self, owner: Owner, session_id: str):
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE id = ? AND tenant_id = ? AND user_id = ?",
                (str(session_id), owner.tenant_id, owner.user_id),
            )

    def submit(self, owner: Owner, payload: dict, idempotency_key: str | None = None) -> dict:
        job_id = str(uuid.uuid4())
        session_id = payload.get("session_id")
        now = _now()
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO runs (id, tenant_id, user_id, session_id, status, phase, request, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'queued', 'queued', ?, ?, ?)""",
                (job_id, owner.tenant_id, owner.user_id, str(session_id), json.dumps(payload, ensure_ascii=False), now, now),
            )
        return {"id": job_id, "status": "queued", "created_at": now, "session_id": str(session_id), "phase": "queued", "error_code": None, "updated_at": now, "started_at": None, "events": [], "paid_attempts": 0, "attempts": 1, "task": payload.get("task", ""), "request_preview": (payload.get("request") or "")[:160]}, True

    def get_job(self, owner: Owner, job_id: str, *, summary: bool = False) -> dict:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT * FROM runs WHERE id = ? AND tenant_id = ? AND user_id = ?",
                (str(job_id), owner.tenant_id, owner.user_id),
            )
            row = cur.fetchone()
            if not row:
                raise ServiceError(404, "run_not_found")
            req = json.loads(row["request"])
            res = json.loads(row["result"]) if row["result"] else None
            return {
                "id": row["id"],
                "session_id": row["session_id"],
                "status": row["status"],
                "phase": row["phase"],
                "request": req,
                "result": res,
                "error_code": row["error_code"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "started_at": row["started_at"],
                "finished_at": row["finished_at"],
            }

    def update_job_status(self, job_id: str, status: str, phase: str, result: dict | None = None, error_code: str | None = None):
        now = _now()
        with self._connect() as conn:
            conn.execute(
                """UPDATE runs SET status = ?, phase = ?, result = ?, error_code = ?, updated_at = ?
                   WHERE id = ?""",
                (status, phase, json.dumps(result, ensure_ascii=False) if result else None, error_code, now, str(job_id)),
            )

    def list_jobs(self, owner: Owner, session_id: str, *, limit: int = 100, before: str | None = None) -> list[dict]:
        with self._connect() as conn:
            query = "SELECT * FROM runs WHERE tenant_id = ? AND user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?"
            cur = conn.execute(query, (owner.tenant_id, owner.user_id, str(session_id), limit))
            items = []
            for row in cur.fetchall():
                req = json.loads(row["request"])
                items.append({
                    "id": row["id"],
                    "session_id": row["session_id"],
                    "status": row["status"],
                    "phase": row["phase"],
                    "task": req.get("task", ""),
                    "request_preview": (req.get("request") or "")[:160],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                })
            return items

    def cancel(self, owner: Owner, job_id: str):
        with self._connect() as conn:
            conn.execute(
                "UPDATE runs SET status = 'cancelled', phase = 'cancelled' WHERE id = ? AND tenant_id = ? AND user_id = ?",
                (str(job_id), owner.tenant_id, owner.user_id),
            )

    def memory(self, job: dict) -> list[dict]:
        return []

    def capabilities(self) -> dict:
        return {
            "capabilities": ["generate", "revise", "repair", "validate", "render", "extract", "rag"],
            "workers": 1,
            "queue_depth": 0,
            "active_runs": 0,
            "queue_age_seconds": 0.0,
        }

    def operational_metrics(self) -> dict:
        return {}

    def counts(self) -> dict:
        return {}

    def cleanup(self) -> int:
        return 0
