import type { Pool } from "pg";
import type { EventStore } from "../modules/event-store";
import { ConcurrencyError } from "../modules/event-store";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowId, RunId, Version } from "../shared/types";

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async loadEvents(workflowId: WorkflowId, runId: RunId, fromVersion: Version): Promise<WorkflowEvent[]> {
    const { rows } = await this.pool.query<{ event_json: unknown }>(
      `SELECT event_json FROM ftn_workflow_events
       WHERE workflow_id = $1 AND run_id = $2 AND version > $3
       ORDER BY version ASC`,
      [workflowId, runId, fromVersion]
    );
    return rows.map((r) => r.event_json as WorkflowEvent);
  }

  async appendEvents(
    workflowId: WorkflowId,
    runId: RunId,
    expectedVersion: Version,
    newEvents: Omit<WorkflowEvent, "id" | "version" | "startedAt">[]
  ): Promise<WorkflowEvent[]> {
    if (newEvents.length === 0) {
      return [];
    }

    const client = await this.pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))", [
        workflowId,
        runId,
      ]);

      const { rows } = await client.query<{ v: string }>(
        `SELECT COALESCE(MAX(version), 0)::text AS v FROM ftn_workflow_events
         WHERE workflow_id = $1 AND run_id = $2`,
        [workflowId, runId]
      );
      const currentVersion = Number.parseInt(rows[0]?.v ?? "0", 10);

      if (currentVersion !== expectedVersion) {
        await client.query("ROLLBACK");
        throw new ConcurrencyError({
          workflowId,
          runId,
          expectedVersion,
          actualVersion: currentVersion,
        });
      }

      const key = `${workflowId}:${runId}`;
      const appended: WorkflowEvent[] = [];

      for (let i = 0; i < newEvents.length; i++) {
        const version = currentVersion + i + 1;
        const id = `${key}:${version}`;
        const full = {
          ...newEvents[i],
          id,
          version,
          startedAt: now,
        } as WorkflowEvent;

        await client.query(
          `INSERT INTO ftn_workflow_events (workflow_id, run_id, version, event_json)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [workflowId, runId, version, JSON.stringify(full)]
        );
        appended.push(full);
      }

      await client.query("COMMIT");
      return appended;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        console.error(e);
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async listRunKeys(): Promise<Array<{ workflowId: string; runId: string }>> {
    const { rows } = await this.pool.query<{ workflow_id: string; run_id: string }>(
      `SELECT DISTINCT workflow_id, run_id FROM ftn_workflow_events ORDER BY workflow_id, run_id`
    );
    return rows.map((r) => ({ workflowId: r.workflow_id, runId: r.run_id }));
  }
}
