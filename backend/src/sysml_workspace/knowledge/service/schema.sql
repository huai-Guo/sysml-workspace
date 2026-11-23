CREATE TABLE IF NOT EXISTS rag_documents (
    tenant_id text NOT NULL, user_id text NOT NULL, id text NOT NULL,
    title text NOT NULL, source_uri text NOT NULL, content text NOT NULL, sha256 text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, user_id, id),
    CHECK (octet_length(content) <= 32768)
);
CREATE INDEX IF NOT EXISTS rag_documents_expiry ON rag_documents(expires_at);
