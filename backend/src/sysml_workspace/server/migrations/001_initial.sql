CREATE TABLE scheduler_lock (id integer PRIMARY KEY CHECK (id = 1));
INSERT INTO scheduler_lock VALUES (1);
CREATE TABLE users (
    tenant_id text NOT NULL, user_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE access_tokens (
    token_hash text PRIMARY KEY, tenant_id text NOT NULL, user_id text NOT NULL,
    label text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL, revoked_at timestamptz,
    FOREIGN KEY (tenant_id, user_id) REFERENCES users ON DELETE CASCADE
);
CREATE TABLE sessions (
    id uuid PRIMARY KEY, tenant_id text NOT NULL, user_id text NOT NULL,
    title text NOT NULL, memory_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users ON DELETE CASCADE,
    UNIQUE(id, tenant_id, user_id)
);
CREATE INDEX sessions_owner ON sessions(tenant_id, user_id, updated_at DESC);
CREATE TABLE jobs (
    id uuid PRIMARY KEY, session_id uuid NOT NULL, tenant_id text NOT NULL, user_id text NOT NULL,
    idempotency_key text NOT NULL, request_hash text NOT NULL, request jsonb NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    result jsonb, error_code text,
    attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_expires_at timestamptz,
    worker_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), started_at timestamptz,
    deadline_at timestamptz NOT NULL,
    FOREIGN KEY(session_id, tenant_id, user_id) REFERENCES sessions(id, tenant_id, user_id) ON DELETE CASCADE,
    UNIQUE(tenant_id, user_id, idempotency_key)
);
CREATE INDEX jobs_queue ON jobs(status, created_at);
CREATE INDEX jobs_owner ON jobs(tenant_id, user_id, created_at DESC);
CREATE INDEX jobs_session ON jobs(session_id, created_at DESC);
CREATE INDEX jobs_leases ON jobs(lease_expires_at) WHERE status = 'running';
CREATE TABLE quotas (
    tenant_id text NOT NULL, user_id text NOT NULL, bucket text NOT NULL,
    used integer NOT NULL, expires_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, user_id, bucket),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users ON DELETE CASCADE
);
CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id text NOT NULL, user_id text NOT NULL, action text NOT NULL, resource_id text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_retention ON audit_events(created_at);
CREATE TABLE workers (
    id text PRIMARY KEY, heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(), capabilities jsonb NOT NULL
);
