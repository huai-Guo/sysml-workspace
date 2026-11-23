ALTER TABLE sessions ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN draft jsonb NOT NULL DEFAULT '{"task":"generate","request":"","sysml_source":"","render":true}';
CREATE TABLE browser_sessions (
    session_hash text PRIMARY KEY,
    token_hash text NOT NULL REFERENCES access_tokens(token_hash) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX browser_sessions_expiry ON browser_sessions(expires_at);
CREATE INDEX browser_sessions_token ON browser_sessions(token_hash, created_at DESC);
ALTER TABLE jobs ADD COLUMN phase text NOT NULL DEFAULT 'queued';
ALTER TABLE jobs ADD COLUMN phase_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE jobs ADD COLUMN events jsonb NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN paid_attempts integer NOT NULL DEFAULT 0;
-- Existing executions predate the durable paid-attempt marker. Treat any
-- previously started model task conservatively; never replay an unknown bill.
UPDATE jobs SET paid_attempts=1
WHERE status IN ('queued','running') AND attempts>0
AND request->>'task' IN ('generate','repair','revise');
UPDATE jobs SET phase=CASE status WHEN 'succeeded' THEN 'completed'
WHEN 'running' THEN 'preparing' ELSE status END, phase_updated_at=updated_at;
CREATE INDEX jobs_active_queue ON jobs(created_at, id) WHERE status IN ('queued','running');
CREATE INDEX jobs_session_page ON jobs(session_id, created_at DESC, id DESC);
