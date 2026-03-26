import type { Pool } from "pg";
import type { SnapshotStore, WorkflowSnapshot } from "../modules/snapshot-store";
import type { WorkflowId, RunId } from "../shared/types";

export class PostgresSnapshotStore implements SnapshotStore {
  constructor(private readonly pool: Pool) {}

  async loadLatestSnapshot(workflowId: WorkflowId, runId: RunId): Promise<WorkflowSnapshot | undefined> {
    const { rows } = await this.pool.query<{
      version: number;
      state_json: unknown;
      created_at: Date;
    }>(
      `SELECT version, state_json, created_at FROM ftn_workflow_snapshots
       WHERE workflow_id = $1 AND run_id = $2`,
      [workflowId, runId]
    );
    if (rows.length === 0) {
      return undefined;
    }
    const r = rows[0];
    return {
      workflowId,
      runId,
      version: r.version,
      state: r.state_json as WorkflowSnapshot["state"],
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
  }

  async saveSnapshot(snapshot: WorkflowSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO ftn_workflow_snapshots (workflow_id, run_id, version, state_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (workflow_id, run_id) DO UPDATE SET
         version = EXCLUDED.version,
         state_json = EXCLUDED.state_json,
         created_at = EXCLUDED.created_at`,
      [
        snapshot.workflowId,
        snapshot.runId,
        snapshot.version,
        JSON.stringify(snapshot.state),
        snapshot.createdAt,
      ]
    );
  }
}
