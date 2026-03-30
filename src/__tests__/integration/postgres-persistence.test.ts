import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { runPostgresMigrations } from "../../infra/postgres-migrations";
import { PostgresEventStore } from "../../infra/postgres-event-store";
import { PostgresSnapshotStore } from "../../infra/postgres-snapshot-store";
import { ConcurrencyError } from "../../modules/event-store";
import type { WorkflowState } from "../../core/workflow-state";

const engineUrl = process.env.FTN_ENGINE_DATABASE_URL ?? process.env.DATABASE_URL;
const describePg = engineUrl ? describe : describe.skip;

describePg("Postgres engine persistence (FTN_ENGINE_DATABASE_URL o DATABASE_URL)", () => {
  let pool: Pool;
  let eventStore: PostgresEventStore;
  let snapshotStore: PostgresSnapshotStore;

  before(async () => {
    pool = new Pool({ connectionString: engineUrl! });
    await runPostgresMigrations(pool);
    eventStore = new PostgresEventStore(pool);
    snapshotStore = new PostgresSnapshotStore(pool);
    await pool.query("TRUNCATE ftn_workflow_events, ftn_workflow_snapshots CASCADE");
  });

  after(async () => {
    await pool.end();
  });

  it("appendEvents y loadEvents conservan el historial", async () => {
    const workflowId = `it-wf-${Date.now()}`;
    const runId = `it-run-${Date.now()}`;

    await eventStore.appendEvents(workflowId, runId, 0, [
      {
        type: "WorkflowStarted",
        workflowId,
        runId,
        payload: { name: "integration", input: { n: 1 } },
      },
    ]);

    const first = await eventStore.loadEvents(workflowId, runId, 0);
    assert.equal(first.length, 1);
    assert.equal(first[0].type, "WorkflowStarted");
    assert.equal(first[0].version, 1);

    await eventStore.appendEvents(workflowId, runId, 1, [
      {
        type: "WorkflowCompleted",
        workflowId,
        runId,
        payload: { result: { ok: true } },
      },
    ]);

    const all = await eventStore.loadEvents(workflowId, runId, 0);
    assert.equal(all.length, 2);
    assert.equal(all[1].type, "WorkflowCompleted");
  });

  it("appendEvents rechaza versión esperada incorrecta (ConcurrencyError)", async () => {
    const workflowId = `it-wf-${Date.now()}`;
    const runId = `it-run-${Date.now()}`;

    await eventStore.appendEvents(workflowId, runId, 0, [
      {
        type: "WorkflowStarted",
        workflowId,
        runId,
        payload: { name: "c", input: {} },
      },
    ]);

    await assert.rejects(
      async () => {
        await eventStore.appendEvents(workflowId, runId, 0, [
          {
            type: "WorkflowCompleted",
            workflowId,
            runId,
            payload: { result: null },
          },
        ]);
      },
      (e: unknown) => {
        assert.ok(e instanceof ConcurrencyError);
        return true;
      }
    );
  });

  it("listRunKeys lista ejecuciones con eventos", async () => {
    const workflowId = `it-wf-${Date.now()}`;
    const runId = `it-run-${Date.now()}`;

    await eventStore.appendEvents(workflowId, runId, 0, [
      {
        type: "WorkflowStarted",
        workflowId,
        runId,
        payload: { name: "list", input: {} },
      },
    ]);

    const keys = await eventStore.listRunKeys();
    assert.ok(keys.some((k) => k.workflowId === workflowId && k.runId === runId));
  });

  it("saveSnapshot y loadLatestSnapshot redondean estado JSON", async () => {
    const workflowId = `it-wf-${Date.now()}`;
    const runId = `it-run-${Date.now()}`;

    const state: WorkflowState = {
      id: workflowId,
      runId,
      status: "running",
      version: 5,
      pendingActivities: [],
      completedActivities: [],
      pendingTimers: [],
      pendingSignalWaits: [],
      steps: [],
      stepState: undefined,
    };

    const createdAt = new Date().toISOString();
    await snapshotStore.saveSnapshot({
      workflowId,
      runId,
      version: 5,
      state,
      createdAt,
    });

    const loaded = await snapshotStore.loadLatestSnapshot(workflowId, runId);
    assert.ok(loaded);
    assert.equal(loaded!.version, 5);
    assert.equal(loaded!.state.id, workflowId);
    assert.equal(loaded!.state.status, "running");
  });
});
