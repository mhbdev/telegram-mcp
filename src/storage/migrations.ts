import type { Database } from "./db.js";

export const migrationSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS principals (
  subject TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  auth_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  role TEXT PRIMARY KEY
);

INSERT INTO roles(role) VALUES
  ('owner'),
  ('admin'),
  ('operator'),
  ('readonly')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS principal_roles (
  subject TEXT NOT NULL REFERENCES principals(subject) ON DELETE CASCADE,
  role TEXT NOT NULL REFERENCES roles(role),
  PRIMARY KEY(subject, role)
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tool_permissions (
  id BIGSERIAL PRIMARY KEY,
  policy_version_id INTEGER NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  operations TEXT[] NOT NULL,
  risk_level TEXT NOT NULL,
  effect TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_accounts (
  id UUID PRIMARY KEY,
  account_ref TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mtproto_accounts (
  id UUID PRIMARY KEY,
  account_ref TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  encrypted_session TEXT NOT NULL,
  encrypted_phone TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS update_handlers (
  id BIGSERIAL PRIMARY KEY,
  account_ref TEXT NOT NULL,
  mode TEXT NOT NULL,
  webhook_url TEXT,
  secret_token TEXT,
  last_update_id BIGINT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_ref, mode)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  principal_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  tool TEXT NOT NULL,
  operation TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS risk_level TEXT,
  ADD COLUMN IF NOT EXISTS approval_id UUID,
  ADD COLUMN IF NOT EXISTS client_context JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY,
  principal_subject TEXT NOT NULL,
  tool TEXT NOT NULL,
  operation TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_tokens (
  id UUID PRIMARY KEY,
  approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_objects (
  id UUID PRIMARY KEY,
  account_ref TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_access_events (
  id UUID PRIMARY KEY,
  media_object_id UUID NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  principal_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL,
  content_ttl_days INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mtproto_operation_journal (
  id UUID PRIMARY KEY,
  account_ref TEXT NOT NULL,
  domain TEXT NOT NULL,
  operation TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_expires
  ON approval_requests(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_lookup
  ON approval_tokens(token_hash, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_media_objects_lookup
  ON media_objects(account_ref, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtproto_operation_journal_lookup
  ON mtproto_operation_journal(account_ref, domain, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tool_op_time
  ON audit_events(tool, operation, timestamp DESC);
`;

export async function runMigrations(db: Database): Promise<void> {
  await db.query(migrationSql);
  await db.query(
    `
      INSERT INTO schema_migrations(name)
      VALUES ($1)
      ON CONFLICT (name) DO NOTHING
    `,
    ["0001_initial_schema"],
  );
}
