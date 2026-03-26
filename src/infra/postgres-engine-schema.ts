import type { Pool } from "pg";

const DDL = `
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
`;

export async function ensurePostgresEngineSchema(pool: Pool): Promise<void> {
  await pool.query(DDL);
}
