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
