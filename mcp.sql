CREATE TABLE IF NOT EXISTS mcp_oauth_records (
 key TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 payload JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_expiry_idx ON mcp_oauth_records(expires_at);
