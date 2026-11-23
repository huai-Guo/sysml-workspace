from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    global_concurrency: int = 4
    tenant_concurrency: int = 2
    max_pending: int = 200
    user_pending: int = 3
    user_requests_per_minute: int = 10
    user_runs_per_day: int = 100
    user_model_calls_per_day: int = 100
    global_model_calls_per_day: int = 2000
    max_sessions_per_user: int = 100
    max_repair_count: int = 2
    run_timeout_seconds: int = 300
    queue_timeout_seconds: int = 1800
    lease_seconds: int = 45
    max_attempts: int = 2
    retention_days: int = 30
    pool_size: int = 10
    browser_session_hours: int = 8
    browser_origin: str = ""
    shutdown_grace_seconds: int = 25
    renderer_url: str = "http://renderer:8081"
    renderer_token: str = field(default="", repr=False)
    rag_url: str = ""
    rag_token: str = field(default="", repr=False)
    metrics_token: str = field(default="", repr=False)
    allowed_hosts: tuple[str, ...] = ("localhost", "127.0.0.1", "testserver")

    def __post_init__(self):
        if self.database_url and not self.database_url.startswith(
            ("postgresql://", "postgres://", "sqlite://")
        ):
            raise ValueError("SYSML_DATABASE_URL must be a PostgreSQL or SQLite connection URL")
        for name in (
            "global_concurrency",
            "tenant_concurrency",
            "max_pending",
            "user_pending",
            "user_requests_per_minute",
            "user_runs_per_day",
            "max_sessions_per_user",
            "user_model_calls_per_day",
            "global_model_calls_per_day",
            "run_timeout_seconds",
            "queue_timeout_seconds",
            "lease_seconds",
            "max_attempts",
            "retention_days",
            "pool_size",
            "browser_session_hours",
            "shutdown_grace_seconds",
        ):
            if not 1 <= getattr(self, name) <= 1_000_000:
                raise ValueError(f"Invalid positive setting: {name}")
        if not 0 <= self.max_repair_count <= 5:
            raise ValueError("max_repair_count must be between 0 and 5")
        if self.lease_seconds < 6:
            raise ValueError("lease_seconds must be at least 6")
        if self.browser_session_hours > 24:
            raise ValueError("Browser sessions must expire within 24 hours")
        if self.shutdown_grace_seconds > 300:
            raise ValueError("Worker shutdown grace must not exceed 300 seconds")
        if self.browser_origin:
            from urllib.parse import urlsplit

            origin = urlsplit(self.browser_origin)
            if (
                origin.scheme not in {"http", "https"}
                or not origin.netloc
                or origin.path not in {"", "/"}
                or origin.query
                or origin.fragment
                or origin.username
                or origin.password
                or (
                    origin.scheme == "http"
                    and origin.hostname not in {"localhost", "127.0.0.1", "::1"}
                )
            ):
                raise ValueError(
                    "SYSML_BROWSER_ORIGIN must be an HTTPS origin (HTTP only on loopback)"
                )

    @classmethod
    def from_env(cls):
        values = {"database_url": os.environ.get("SYSML_DATABASE_URL", "sqlite:///workspace.db")}
        for name, field_info in cls.__dataclass_fields__.items():
            raw = os.getenv("SYSML_" + name.upper())
            if raw is None or name == "database_url":
                continue
            if name == "allowed_hosts":
                values[name] = tuple(item.strip() for item in raw.split(",") if item.strip())
            elif isinstance(field_info.default, int):
                values[name] = int(raw)
            else:
                values[name] = raw
        return cls(**values)
