from __future__ import annotations

import hashlib
import json
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta
from importlib.resources import files

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .settings import Settings

SCHEMA_VERSION = 2
RUN_SUMMARY = """id,session_id,status,error_code,created_at,updated_at,started_at,
    attempts,phase,phase_updated_at,events,paid_attempts,
    request->>'task' AS task, left(request->>'request',160) AS request_preview"""


class ServiceError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


@dataclass(frozen=True)
class Owner:
    tenant_id: str
    user_id: str


def migrate(database_url: str):
    with psycopg.connect(database_url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(77331451001)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
        migrations = {1: "001_initial.sql", 2: "002_workbench.sql"}
        if applied - migrations.keys():
            raise RuntimeError("Database schema is newer than this application")
        for version, filename in migrations.items():
            if version not in applied:
                conn.execute(
                    files("sysml_workspace.server")
                    .joinpath("migrations", filename)
                    .read_text(encoding="utf-8")
                )
                conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (version,))


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.pool = ConnectionPool(
            settings.database_url,
            min_size=0,
            max_size=settings.pool_size,
            open=True,
            timeout=5,
            max_waiting=100,
            kwargs={
                "row_factory": dict_row,
                "connect_timeout": 5,
                "options": "-c statement_timeout=5000 -c lock_timeout=4000",
            },
        )

    def close(self):
        self.pool.close()

    @staticmethod
    def _lock(conn):
        conn.execute("SELECT id FROM scheduler_lock WHERE id=1 FOR UPDATE").fetchone()

    @staticmethod
    def _audit(conn, owner: Owner, action: str, resource_id: str | None = None):
        conn.execute(
            "INSERT INTO audit_events(tenant_id,user_id,action,resource_id) VALUES (%s,%s,%s,%s)",
            (owner.tenant_id, owner.user_id, action, resource_id),
        )

    def readiness(self):
        with self.pool.connection() as conn:
            row = conn.execute("SELECT max(version) AS version FROM schema_migrations").fetchone()
            if row["version"] != SCHEMA_VERSION:
                raise RuntimeError("Database migrations are required")
            workers = conn.execute(
                "SELECT capabilities FROM workers WHERE heartbeat_at > clock_timestamp() - interval '60 seconds'"
            ).fetchall()
            return {
                "database": True,
                "workers": len(workers),
                "capabilities": sorted(
                    {c for w in workers for c, enabled in w["capabilities"].items() if enabled}
                ),
            }

    def issue_token(self, owner: Owner, label: str, days: int = 90) -> str:
        if not all(
            re.fullmatch(r"[A-Za-z0-9_.@-]{1,100}", v) for v in (owner.tenant_id, owner.user_id)
        ):
            raise ValueError("Tenant/user IDs must be 1-100 ASCII letters, digits or _.@-")
        if not 1 <= days <= 365 or not 1 <= len(label) <= 100:
            raise ValueError("Invalid token label or expiry")
        token = "sma_" + secrets.token_urlsafe(32)
        with self.pool.connection() as conn:
            conn.execute(
                "INSERT INTO users(tenant_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                (owner.tenant_id, owner.user_id),
            )
            conn.execute(
                "INSERT INTO access_tokens(token_hash,tenant_id,user_id,label,expires_at) VALUES (%s,%s,%s,%s,clock_timestamp()+%s)",
                (
                    hashlib.sha256(token.encode()).hexdigest(),
                    owner.tenant_id,
                    owner.user_id,
                    label,
                    timedelta(days=days),
                ),
            )
            self._audit(conn, owner, "token_issued")
        return token

    def authenticate(self, token: str) -> Owner:
        if not re.fullmatch(r"sma_[A-Za-z0-9_-]{43}", token):
            raise ServiceError(401, "invalid_credentials")
        with self.pool.connection() as conn:
            row = conn.execute(
                "SELECT tenant_id,user_id FROM access_tokens WHERE token_hash=%s AND revoked_at IS NULL AND expires_at>clock_timestamp()",
                (hashlib.sha256(token.encode()).hexdigest(),),
            ).fetchone()
        if not row:
            raise ServiceError(401, "invalid_credentials")
        return Owner(row["tenant_id"], row["user_id"])

    def revoke_tokens(self, owner: Owner):
        with self.pool.connection() as conn:
            conn.execute(
                "UPDATE access_tokens SET revoked_at=clock_timestamp() WHERE tenant_id=%s AND user_id=%s",
                (owner.tenant_id, owner.user_id),
            )
            self._audit(conn, owner, "tokens_revoked")

    def create_browser_session(self, token: str):
        owner = self.authenticate(token)
        session = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.pool.connection() as conn:
            row = conn.execute(
                """INSERT INTO browser_sessions(session_hash,token_hash,expires_at)
                SELECT %s,token_hash,LEAST(expires_at,clock_timestamp()+%s)
                FROM access_tokens WHERE token_hash=%s AND revoked_at IS NULL
                AND expires_at>clock_timestamp() RETURNING expires_at""",
                (
                    hashlib.sha256(session.encode()).hexdigest(),
                    timedelta(hours=self.settings.browser_session_hours),
                    token_hash,
                ),
            ).fetchone()
            if not row:
                raise ServiceError(401, "invalid_credentials")
            # Bound active browser sessions for a credential; newest five win.
            conn.execute(
                """DELETE FROM browser_sessions WHERE session_hash IN (
                SELECT session_hash FROM browser_sessions WHERE token_hash=%s
                ORDER BY created_at DESC, session_hash DESC OFFSET 5)""",
                (token_hash,),
            )
            return session, owner, row["expires_at"]

    def authenticate_browser(self, session: str) -> Owner:
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", session):
            raise ServiceError(401, "invalid_credentials")
        with self.pool.connection() as conn:
            row = conn.execute(
                """SELECT t.tenant_id,t.user_id FROM browser_sessions s
                JOIN access_tokens t USING(token_hash) WHERE s.session_hash=%s
                AND s.expires_at>clock_timestamp() AND t.expires_at>clock_timestamp()
                AND t.revoked_at IS NULL""",
                (hashlib.sha256(session.encode()).hexdigest(),),
            ).fetchone()
        if not row:
            raise ServiceError(401, "invalid_credentials")
        return Owner(row["tenant_id"], row["user_id"])

    def revoke_browser_session(self, session: str):
        with self.pool.connection() as conn:
            conn.execute(
                "DELETE FROM browser_sessions WHERE session_hash=%s",
                (hashlib.sha256(session.encode()).hexdigest(),),
            )

    def create_session(self, owner: Owner, title: str, memory_enabled: bool):
        with self.pool.connection() as conn:
            self._lock(conn)
            count = conn.execute(
                "SELECT count(*) AS n FROM sessions WHERE tenant_id=%s AND user_id=%s",
                (owner.tenant_id, owner.user_id),
            ).fetchone()["n"]
            if count >= self.settings.max_sessions_per_user:
                raise ServiceError(429, "session_quota_exceeded")
            row = conn.execute(
                "INSERT INTO sessions(id,tenant_id,user_id,title,memory_enabled) VALUES (%s,%s,%s,%s,%s) RETURNING *",
                (uuid.uuid4(), owner.tenant_id, owner.user_id, title, memory_enabled),
            ).fetchone()
            self._audit(conn, owner, "session_created", str(row["id"]))
            return row

    def list_sessions(self, owner: Owner):
        with self.pool.connection() as conn:
            return conn.execute(
                "SELECT id,title,memory_enabled,revision,created_at,updated_at FROM sessions WHERE tenant_id=%s AND user_id=%s ORDER BY updated_at DESC,id DESC LIMIT 100",
                (owner.tenant_id, owner.user_id),
            ).fetchall()

    def get_session(self, owner: Owner, session_id):
        with self.pool.connection() as conn:
            return self._session(conn, owner, session_id)

    def update_session(self, owner: Owner, session_id, values: dict):
        with self.pool.connection() as conn:
            self._session(conn, owner, session_id)
            row = conn.execute(
                """UPDATE sessions SET title=COALESCE(%s,title),
                memory_enabled=COALESCE(%s,memory_enabled), draft=COALESCE(%s,draft),
                revision=revision+1,updated_at=clock_timestamp()
                WHERE id=%s AND tenant_id=%s AND user_id=%s AND revision=%s RETURNING *""",
                (
                    values.get("title"),
                    values.get("memory_enabled"),
                    Jsonb(values["draft"]) if "draft" in values else None,
                    session_id,
                    owner.tenant_id,
                    owner.user_id,
                    values["revision"],
                ),
            ).fetchone()
            if not row:
                raise ServiceError(409, "draft_conflict")
            return row

    @staticmethod
    def _session(conn, owner: Owner, session_id):
        row = conn.execute(
            "SELECT * FROM sessions WHERE id=%s AND tenant_id=%s AND user_id=%s",
            (session_id, owner.tenant_id, owner.user_id),
        ).fetchone()
        if not row:
            raise ServiceError(404, "session_not_found")
        return row

    def delete_session(self, owner: Owner, session_id):
        with self.pool.connection() as conn:
            self._lock(conn)
            self._session(conn, owner, session_id)
            conn.execute(
                "DELETE FROM sessions WHERE id=%s AND tenant_id=%s AND user_id=%s",
                (session_id, owner.tenant_id, owner.user_id),
            )
            self._audit(conn, owner, "session_deleted", str(session_id))

    def submit(self, owner: Owner, payload: dict, idempotency_key: str):
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        with self.pool.connection() as conn:
            self._lock(conn)
            self._session(conn, owner, payload["session_id"])
            previous = conn.execute(
                "SELECT * FROM jobs WHERE tenant_id=%s AND user_id=%s AND idempotency_key=%s",
                (owner.tenant_id, owner.user_id, idempotency_key),
            ).fetchone()
            if previous:
                if previous["request_hash"] != digest:
                    raise ServiceError(409, "idempotency_conflict")
                return previous, False
            counts = conn.execute(
                "SELECT count(*) AS total, count(*) FILTER (WHERE tenant_id=%s AND user_id=%s) AS owned FROM jobs WHERE status IN ('queued','running')",
                (owner.tenant_id, owner.user_id),
            ).fetchone()
            if counts["total"] >= self.settings.max_pending:
                raise ServiceError(503, "queue_full")
            if counts["owned"] >= self.settings.user_pending:
                raise ServiceError(429, "pending_quota_exceeded")
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            for bucket, limit, expiry in (
                (
                    "minute:" + now.strftime("%Y%m%d%H%M"),
                    self.settings.user_requests_per_minute,
                    now + timedelta(minutes=2),
                ),
                (
                    "day:" + now.strftime("%Y%m%d"),
                    self.settings.user_runs_per_day,
                    now + timedelta(days=2),
                ),
            ):
                quota = conn.execute(
                    "INSERT INTO quotas(tenant_id,user_id,bucket,used,expires_at) VALUES (%s,%s,%s,1,%s) ON CONFLICT(tenant_id,user_id,bucket) DO UPDATE SET used=quotas.used+1 RETURNING used",
                    (owner.tenant_id, owner.user_id, bucket, expiry),
                ).fetchone()
                if quota["used"] > limit:
                    raise ServiceError(429, "request_quota_exceeded")
            row = conn.execute(
                "INSERT INTO jobs(id,session_id,tenant_id,user_id,idempotency_key,request_hash,request,deadline_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                (
                    uuid.uuid4(),
                    payload["session_id"],
                    owner.tenant_id,
                    owner.user_id,
                    idempotency_key,
                    digest,
                    Jsonb(payload),
                    now + timedelta(seconds=self.settings.queue_timeout_seconds),
                ),
            ).fetchone()
            conn.execute(
                "UPDATE sessions SET updated_at=clock_timestamp() WHERE id=%s",
                (payload["session_id"],),
            )
            self._audit(conn, owner, "run_submitted", str(row["id"]))
            return row, True

    def get_job(self, owner: Owner, job_id, *, summary: bool = False):
        with self.pool.connection() as conn:
            row = conn.execute(
                f"SELECT {RUN_SUMMARY if summary else '*'} FROM jobs WHERE id=%s AND tenant_id=%s AND user_id=%s",
                (job_id, owner.tenant_id, owner.user_id),
            ).fetchone()
            if not row:
                raise ServiceError(404, "run_not_found")
            return row

    def list_jobs(self, owner: Owner, session_id, *, limit: int = 100, before=None):
        with self.pool.connection() as conn:
            self._session(conn, owner, session_id)
            clause = " AND (created_at,id)<(%s,%s)" if before else ""
            params = (session_id, owner.tenant_id, owner.user_id, *(before or ()), limit)
            return conn.execute(
                f"SELECT {RUN_SUMMARY} FROM jobs WHERE session_id=%s AND tenant_id=%s AND user_id=%s{clause} ORDER BY created_at DESC,id DESC LIMIT %s",
                params,
            ).fetchall()

    def cancel(self, owner: Owner, job_id):
        with self.pool.connection() as conn:
            self._lock(conn)
            row = conn.execute(
                "UPDATE jobs SET status='cancelled',phase='cancelled',phase_updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=%s AND tenant_id=%s AND user_id=%s AND status IN ('queued','running') RETURNING id",
                (job_id, owner.tenant_id, owner.user_id),
            ).fetchone()
            if (
                not row
                and not conn.execute(
                    "SELECT id FROM jobs WHERE id=%s AND tenant_id=%s AND user_id=%s",
                    (job_id, owner.tenant_id, owner.user_id),
                ).fetchone()
            ):
                raise ServiceError(404, "run_not_found")
            self._audit(conn, owner, "run_cancelled", str(job_id))

    def claim(self, worker_id: str):
        s = self.settings
        with self.pool.connection() as conn:
            self._lock(conn)
            conn.execute(
                "UPDATE jobs SET status='failed',phase='failed',error_code='deadline_exceeded',lease_token=NULL,updated_at=clock_timestamp() WHERE status IN ('queued','running') AND deadline_at<=clock_timestamp()"
            )
            conn.execute(
                """UPDATE jobs SET status=CASE WHEN paid_attempts>0 OR attempts>=%s THEN 'failed' ELSE 'queued' END,
                phase=CASE WHEN paid_attempts>0 OR attempts>=%s THEN 'failed' ELSE 'recovering' END,
                error_code=CASE WHEN paid_attempts>0 THEN 'paid_call_interrupted' WHEN attempts>=%s THEN 'worker_lost' ELSE NULL END,
                lease_token=NULL,lease_expires_at=NULL,phase_updated_at=clock_timestamp(),updated_at=clock_timestamp()
                WHERE status='running' AND lease_expires_at<=clock_timestamp()""",
                (s.max_attempts, s.max_attempts, s.max_attempts),
            )
            running = conn.execute(
                "SELECT count(*) AS n FROM jobs WHERE status='running'"
            ).fetchone()["n"]
            if running >= s.global_concurrency:
                return None
            row = conn.execute(
                """SELECT j.* FROM jobs j WHERE j.status='queued'
                AND NOT EXISTS(SELECT 1 FROM jobs r WHERE r.status='running' AND r.session_id=j.session_id)
                AND (SELECT count(*) FROM jobs r WHERE r.status='running' AND r.tenant_id=j.tenant_id)<%s
                ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1""",
                (s.tenant_concurrency,),
            ).fetchone()
            if not row:
                return None
            token = uuid.uuid4()
            return conn.execute(
                "UPDATE jobs SET status='running',phase='preparing',phase_updated_at=clock_timestamp(),attempts=attempts+1,lease_token=%s,lease_expires_at=clock_timestamp()+%s,worker_id=%s,deadline_at=LEAST(deadline_at,COALESCE(started_at,clock_timestamp())+%s),started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=%s RETURNING *",
                (
                    token,
                    timedelta(seconds=s.lease_seconds),
                    worker_id,
                    timedelta(seconds=s.run_timeout_seconds),
                    row["id"],
                ),
            ).fetchone()

    def set_phase(self, job: dict, phase: str) -> bool:
        if phase not in {
            "preparing",
            "retrieving",
            "generating",
            "repairing",
            "validating",
            "rendering",
        }:
            raise ValueError("Unknown run phase")
        with self.pool.connection() as conn:
            return bool(
                conn.execute(
                    """UPDATE jobs SET phase=%s,phase_updated_at=clock_timestamp(),updated_at=clock_timestamp(),
                events=events || jsonb_build_array(jsonb_build_object('phase',%s::text,'at',clock_timestamp(),'attempt',attempts))
                WHERE id=%s AND lease_token=%s AND status='running' AND lease_expires_at>clock_timestamp()
                AND deadline_at>clock_timestamp() AND jsonb_array_length(events)<64 RETURNING id""",
                    (phase, phase, job["id"], job["lease_token"]),
                ).fetchone()
            )

    def heartbeat(self, job_id, lease_token) -> bool:
        with self.pool.connection() as conn:
            return bool(
                conn.execute(
                    "UPDATE jobs SET lease_expires_at=clock_timestamp()+%s WHERE id=%s AND lease_token=%s AND status='running' AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING id",
                    (timedelta(seconds=self.settings.lease_seconds), job_id, lease_token),
                ).fetchone()
            )

    def finish(
        self, job_id, lease_token, result: dict | None, error_code: str | None = None
    ) -> bool:
        if result is not None and len(json.dumps(result).encode()) > 8 * 1024 * 1024:
            result, error_code = None, "result_too_large"
        succeeded = (
            result is not None and result.get("run_status") == "succeeded" and error_code is None
        )
        with self.pool.connection() as conn:
            row = conn.execute(
                "UPDATE jobs SET status=%s,phase=%s,phase_updated_at=clock_timestamp(),result=%s,error_code=%s,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=%s AND lease_token=%s AND status='running' AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING tenant_id,user_id",
                (
                    "succeeded" if succeeded else "failed",
                    "completed" if succeeded else "failed",
                    Jsonb(result) if result is not None else None,
                    error_code or ((result or {}).get("error_message") if not succeeded else None),
                    job_id,
                    lease_token,
                ),
            ).fetchone()
            if row:
                self._audit(
                    conn, Owner(row["tenant_id"], row["user_id"]), "run_finished", str(job_id)
                )
            return bool(row)

    def memory(self, job: dict) -> list[dict]:
        owner = Owner(job["tenant_id"], job["user_id"])
        with self.pool.connection() as conn:
            session = self._session(conn, owner, job["session_id"])
            if not session["memory_enabled"]:
                return []
            return conn.execute(
                "SELECT request,result FROM jobs WHERE session_id=%s AND tenant_id=%s AND user_id=%s AND status='succeeded' AND created_at<%s ORDER BY created_at DESC LIMIT 6",
                (job["session_id"], owner.tenant_id, owner.user_id, job["created_at"]),
            ).fetchall()[::-1]

    def worker_status(self, worker_id: str, capabilities: dict):
        with self.pool.connection() as conn:
            conn.execute(
                "INSERT INTO workers(id,capabilities) VALUES (%s,%s) ON CONFLICT(id) DO UPDATE SET heartbeat_at=clock_timestamp(),capabilities=EXCLUDED.capabilities",
                (worker_id, Jsonb(capabilities)),
            )

    def retire_worker(self, worker_id: str):
        with self.pool.connection() as conn:
            conn.execute("DELETE FROM workers WHERE id=%s", (worker_id,))

    def reserve_model_call(self, job: dict):
        # Reservations count attempted calls even if a provider times out or a worker dies.
        # No refund/retry can accidentally bypass the cross-replica paid-call budget.
        with self.pool.connection() as conn:
            self._lock(conn)
            active = conn.execute(
                "SELECT id FROM jobs WHERE id=%s AND lease_token=%s AND status='running' AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()",
                (job["id"], job["lease_token"]),
            ).fetchone()
            if not active:
                raise ServiceError(409, "lease_lost")
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            bucket = "model:" + now.strftime("%Y%m%d")
            total = conn.execute(
                "SELECT COALESCE(sum(used),0) AS n FROM quotas WHERE bucket=%s", (bucket,)
            ).fetchone()["n"]
            if total >= self.settings.global_model_calls_per_day:
                raise ServiceError(429, "model_daily_budget_exceeded")
            quota = conn.execute(
                "INSERT INTO quotas(tenant_id,user_id,bucket,used,expires_at) VALUES (%s,%s,%s,1,%s) ON CONFLICT(tenant_id,user_id,bucket) DO UPDATE SET used=quotas.used+1 RETURNING used",
                (job["tenant_id"], job["user_id"], bucket, now + timedelta(days=2)),
            ).fetchone()
            if quota["used"] > self.settings.user_model_calls_per_day:
                raise ServiceError(429, "model_user_budget_exceeded")
            conn.execute("UPDATE jobs SET paid_attempts=paid_attempts+1 WHERE id=%s", (job["id"],))

    def cleanup(self) -> int:
        with self.pool.connection() as conn:
            self._lock(conn)
            # An active session must not retain old prompts/results indefinitely.
            conn.execute(
                "DELETE FROM jobs WHERE created_at<clock_timestamp()-%s",
                (timedelta(days=self.settings.retention_days),),
            )
            result = conn.execute(
                "DELETE FROM sessions WHERE updated_at<clock_timestamp()-%s",
                (timedelta(days=self.settings.retention_days),),
            )
            conn.execute("DELETE FROM quotas WHERE expires_at<clock_timestamp()")
            conn.execute("DELETE FROM browser_sessions WHERE expires_at<clock_timestamp()")
            conn.execute(
                "DELETE FROM audit_events WHERE created_at<clock_timestamp()-%s",
                (timedelta(days=self.settings.retention_days),),
            )
            conn.execute(
                "DELETE FROM workers WHERE heartbeat_at<clock_timestamp()-interval '1 day'"
            )
            return result.rowcount

    def counts(self):
        with self.pool.connection() as conn:
            return {
                r["status"]: r["n"]
                for r in conn.execute(
                    "SELECT status,count(*) AS n FROM jobs GROUP BY status"
                ).fetchall()
            }

    def operational_metrics(self):
        with self.pool.connection() as conn:
            return conn.execute(
                """SELECT
                COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at) FILTER (WHERE status='queued')),0)::float AS queue_oldest_seconds,
                COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(started_at) FILTER (WHERE status='running')),0)::float AS running_oldest_seconds,
                (SELECT count(*) FROM workers WHERE heartbeat_at>clock_timestamp()-interval '60 seconds') AS workers_available
                FROM jobs WHERE status IN ('queued','running')"""
            ).fetchone()
