import type { Pool } from "pg";

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ftn_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

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
];

/**
 * Aplica migraciones pendientes del motor FTN (tablas de eventos y snapshots).
 * Idempotente: migraciones ya registradas en `ftn_schema_migrations` se omiten.
 */
export async function runPostgresMigrations(pool: Pool): Promise<void> {
  await pool.query(MIGRATION_TABLE_SQL);

  const { rows } = await pool.query<{ version: number }>(
    "SELECT version FROM ftn_schema_migrations ORDER BY version ASC"
  );
  const applied = new Set(rows.map((r) => r.version));

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) {
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
    } finally {
      client.release();
    }
  }
}

export function listPostgresMigrations(): readonly PostgresMigration[] {
  return MIGRATIONS;
}
