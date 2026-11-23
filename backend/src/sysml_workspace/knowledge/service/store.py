import hashlib
from datetime import timedelta
from importlib.resources import files

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def migrate(url):
    with psycopg.connect(url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(77331451002)")
        conn.execute(files("sysml_workspace.knowledge.service").joinpath("schema.sql").read_text())


class Store:
    def __init__(self, url: str, retention_days: int = 30):
        if not 1 <= retention_days <= 365:
            raise ValueError("RAG_RETENTION_DAYS must be between 1 and 365")
        self.retention_days = retention_days
        self.pool = ConnectionPool(url, min_size=0, max_size=5, open=True, timeout=5,
                                   kwargs={"row_factory": dict_row, "connect_timeout": 5, "options": "-c statement_timeout=5000 -c lock_timeout=4000"})

    def readiness(self):
        with self.pool.connection() as conn:
            # An alive process with a missing migration is not ready to serve traffic.
            conn.execute("SELECT tenant_id,user_id,id,title,source_uri,content,sha256,updated_at,expires_at FROM rag_documents LIMIT 0")

    def put(self, scope, document):
        with self.pool.connection() as conn:
            # Scope-based lock serializes each user's quota/upsert without blocking other users.
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (scope.tenant_id + ":" + scope.user_id,))
            conn.execute("DELETE FROM rag_documents WHERE tenant_id=%s AND user_id=%s AND expires_at<=clock_timestamp()", (scope.tenant_id, scope.user_id))
            count = conn.execute("SELECT count(*) AS n FROM rag_documents WHERE tenant_id=%s AND user_id=%s AND id<>%s", (scope.tenant_id, scope.user_id, document.id)).fetchone()["n"]
            if count >= 100:
                raise ValueError("document_quota_exceeded")
            digest = hashlib.sha256(document.content.encode()).hexdigest()
            conn.execute("""INSERT INTO rag_documents(tenant_id,user_id,id,title,source_uri,content,sha256,expires_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,clock_timestamp()+%s)
                ON CONFLICT(tenant_id,user_id,id) DO UPDATE SET title=EXCLUDED.title,source_uri=EXCLUDED.source_uri,
                content=EXCLUDED.content,sha256=EXCLUDED.sha256,updated_at=clock_timestamp(),expires_at=EXCLUDED.expires_at""",
                (scope.tenant_id, scope.user_id, document.id, document.title, document.source_uri, document.content, digest, timedelta(days=self.retention_days)))
            return {"id": document.id, "sha256": digest}

    def documents(self, scope):
        with self.pool.connection() as conn:
            return conn.execute("SELECT id,title,source_uri,content,sha256,updated_at FROM rag_documents WHERE tenant_id=%s AND user_id=%s AND expires_at>clock_timestamp() ORDER BY id LIMIT 100", (scope.tenant_id, scope.user_id)).fetchall()

    def delete(self, scope, document_id):
        with self.pool.connection() as conn:
            return conn.execute("DELETE FROM rag_documents WHERE tenant_id=%s AND user_id=%s AND id=%s", (scope.tenant_id, scope.user_id, document_id)).rowcount

    def cleanup(self):
        with self.pool.connection() as conn:
            return conn.execute("DELETE FROM rag_documents WHERE expires_at<=clock_timestamp()").rowcount
