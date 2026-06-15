import type { Pool } from "pg";

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ftn_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const MIGRATION_LOCK_K1 = 8291031;
const MIGRATION_LOCK_K2 = 42042;

export interface PostgresMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 1,
    name: "initial_engine_tables",
    sql: `
CREATE TABLE IF NOT EXISTS ftn_workflow_events (
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_json JSONB NOT NULL,
  PRIMARY KEY (workflow_id, run_id, version)
);

CREATE INDEX IF NOT EXISTS ftn_workflow_events_run ON ftn_workflow_events (workflow_id, run_id);

CREATE TABLE IF NOT EXISTS ftn_workflow_snapshots (
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workflow_id, run_id)
);
`,
  },
  {
    version: 2,
    name: "ftn_users",
    sql: `
CREATE TABLE IF NOT EXISTS ftn_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ftn_users_username_lower ON ftn_users (lower(username));
`,
  },
  {
    version: 3,
    name: "engine_prod_indexes_and_comments",
    sql: `
-- Búsquedas por tipo de evento (operación, métricas, soporte)
CREATE INDEX IF NOT EXISTS ftn_workflow_events_event_type
  ON ftn_workflow_events ((event_json->>'type'));

COMMENT ON TABLE ftn_workflow_events IS
  'Stream append-only por (workflow_id, run_id, version). Concurrencia: appendEvents usa expectedVersion + bloqueo advisory por stream.';

COMMENT ON TABLE ftn_workflow_snapshots IS
  'Último snapshot por run (UPSERT). Coherencia: última escritura gana en carreras concurrentes de saveSnapshot.';

COMMENT ON COLUMN ftn_workflow_events.event_json IS
  'WorkflowEvent serializado; debe incluir type, workflowId, runId, version, id, startedAt tras append.';
`,
  },
  {
    version: 4,
    name: "designer_workflows",
    sql: `
CREATE TABLE IF NOT EXISTS ftn_designer_workflows (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  last_scheduled_run_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ftn_designer_workflows_updated ON ftn_designer_workflows (updated_at);

COMMENT ON TABLE ftn_designer_workflows IS
  'Workflows del designer (JSON). last_scheduled_run_at evita dobles disparos el mismo día (TZ de la schedule).';
`,
  },
  {
    version: 5,
    name: "credentials_store",
    sql: `
CREATE TABLE IF NOT EXISTS ftn_credentials (
  provider TEXT PRIMARY KEY,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_secrets TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ftn_credentials_updated_at ON ftn_credentials (updated_at DESC);
`,
  },
  {
    version: 6,
    name: "credentials_per_subject",
    sql: `
ALTER TABLE ftn_credentials
  ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'system';

ALTER TABLE ftn_credentials
  DROP CONSTRAINT IF EXISTS ftn_credentials_pkey;

ALTER TABLE ftn_credentials
  ADD CONSTRAINT ftn_credentials_pkey PRIMARY KEY (subject, provider);

CREATE INDEX IF NOT EXISTS ftn_credentials_subject_provider ON ftn_credentials (subject, provider);
`,
  },
  {
    version: 7,
    name: "designer_workflows_per_subject",
    sql: `
ALTER TABLE ftn_designer_workflows
  ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'system';

ALTER TABLE ftn_designer_workflows
  DROP CONSTRAINT IF EXISTS ftn_designer_workflows_pkey;

ALTER TABLE ftn_designer_workflows
  ADD CONSTRAINT ftn_designer_workflows_pkey PRIMARY KEY (subject, id);

CREATE INDEX IF NOT EXISTS ftn_designer_workflows_subject_id ON ftn_designer_workflows (subject, id);
`,
  },
  {
    version: 8,
    name: "designer_scheduler_last_error",
    sql: `
ALTER TABLE ftn_designer_workflows
  ADD COLUMN IF NOT EXISTS last_scheduled_error TEXT NULL;
`,
  },
  {
    version: 9,
    name: "auth_scopes_refresh_revocation_audit",
    sql: `
ALTER TABLE ftn_users
  ADD COLUMN IF NOT EXISTS scopes TEXT NULL;

COMMENT ON COLUMN ftn_users.scopes IS
  'Scopes RBAC separados por espacio o coma; NULL usa FTN_AUTH_LOGIN_SCOPES al emitir JWT.';

CREATE TABLE IF NOT EXISTS ftn_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ftn_refresh_tokens_hash ON ftn_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ftn_refresh_tokens_username ON ftn_refresh_tokens (username);
CREATE INDEX IF NOT EXISTS ftn_refresh_tokens_expires ON ftn_refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS ftn_revoked_access_tokens (
  jti TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ftn_revoked_access_tokens_expires ON ftn_revoked_access_tokens (expires_at);

CREATE TABLE IF NOT EXISTS ftn_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NULL,
  detail_json JSONB NULL
);

CREATE INDEX IF NOT EXISTS ftn_audit_log_occurred ON ftn_audit_log (occurred_at DESC);
`,
  },
  {
    version: 10,
    name: "demo_users_signup",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  stripe_session_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE users ADD PRIMARY KEY (email);
  END IF;
END $$;
`,
  },
  {
    version: 11,
    name: "credentials_secret_reference_model",
    sql: `
ALTER TABLE ftn_credentials
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE ftn_credentials
  ADD COLUMN IF NOT EXISTS secret_ref TEXT NULL;

ALTER TABLE ftn_credentials
  ADD COLUMN IF NOT EXISTS secret_backend TEXT NULL;

UPDATE ftn_credentials
SET secret_ref = encrypted_secrets
WHERE secret_ref IS NULL AND encrypted_secrets IS NOT NULL;

UPDATE ftn_credentials
SET secret_backend = CASE
  WHEN COALESCE(secret_ref, encrypted_secrets) LIKE 'vault:%' THEN 'vault'
  WHEN COALESCE(secret_ref, encrypted_secrets) IS NOT NULL THEN 'encrypted'
  ELSE NULL
END
WHERE secret_backend IS NULL;

ALTER TABLE ftn_credentials
  DROP CONSTRAINT IF EXISTS ftn_credentials_secret_backend_check;

ALTER TABLE ftn_credentials
  ADD CONSTRAINT ftn_credentials_secret_backend_check
  CHECK (secret_backend IS NULL OR secret_backend IN ('encrypted', 'vault'));

CREATE INDEX IF NOT EXISTS ftn_credentials_secret_backend ON ftn_credentials (secret_backend);
`,
  },
  {
    version: 12,
    name: "designer_templates_per_subject",
    sql: `
CREATE TABLE IF NOT EXISTS ftn_designer_templates (
  subject TEXT NOT NULL,
  id TEXT NOT NULL,
  source_template_id TEXT NULL,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject, id)
);

CREATE INDEX IF NOT EXISTS ftn_designer_templates_subject ON ftn_designer_templates (subject, updated_at DESC);

COMMENT ON TABLE ftn_designer_templates IS
  'Plantillas de workflow por usuario; copias editables de las plantillas del sistema.';
`,
  },
];

export async function runPostgresMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [MIGRATION_LOCK_K1, MIGRATION_LOCK_K2]);

    await client.query(MIGRATION_TABLE_SQL);

    const { rows } = await client.query<{ version: number }>(
      "SELECT version FROM ftn_schema_migrations ORDER BY version ASC"
    );
    const applied = new Set(rows.map((r) => r.version));

    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO ftn_schema_migrations (version, name) VALUES ($1, $2)", [
          m.version,
          m.name,
        ]);
        await client.query("COMMIT");
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [MIGRATION_LOCK_K1, MIGRATION_LOCK_K2]);
    } catch {
      /* ignore */
    }
    client.release();
  }
}

export function listPostgresMigrations(): readonly PostgresMigration[] {
  return MIGRATIONS;
}
