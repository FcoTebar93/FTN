import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { DefaultWorkflowEngine } from "../../core/default-engine";
import { InMemoryTaskQueue } from "../../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../../infra/inmemory-workflow-runtime";
import { runPostgresMigrations } from "../../infra/postgres-migrations";
import { PostgresEventStore } from "../../infra/postgres-event-store";
import { PostgresSnapshotStore } from "../../infra/postgres-snapshot-store";

const engineUrl = process.env.FTN_ENGINE_DATABASE_URL ?? process.env.DATABASE_URL;
const describePg = engineUrl ? describe : describe.skip;

describePg("InMemoryWorkflowRuntime con stores Postgres", () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: engineUrl! });
    await runPostgresMigrations(pool);
    await pool.query("TRUNCATE ftn_workflow_events, ftn_workflow_snapshots CASCADE");
  });

  after(async () => {
    await pool.end();
  });

  it("completa un workflow sin actividades y persiste el historial en Postgres", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new PostgresEventStore(pool);
    const snapshotStore = new PostgresSnapshotStore(pool);
    const taskQueue = new InMemoryTaskQueue();

    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "pg-e2e",
      input: { x: 1 },
      definition: async (_ftn, input: { x: number }) => ({ sum: input.x + 1 }),
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { sum: 2 });

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    assert.ok(events.length >= 2);
    assert.equal(events[0].type, "WorkflowStarted");
    assert.ok(events.some((e) => e.type === "WorkflowCompleted"));
  });

  it("rehidrata el estado con nuevas instancias de store sobre el mismo pool", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new PostgresEventStore(pool);
    const snapshotStore = new PostgresSnapshotStore(pool);
    const taskQueue = new InMemoryTaskQueue();

    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "pg-rehydrate",
      input: {},
      definition: async () => ({ ok: true }),
    });

    await runtime.runWorkflowTick(workflowId, runId);

    const runtime2 = new InMemoryWorkflowRuntime({
      engine,
      eventStore: new PostgresEventStore(pool),
      snapshotStore: new PostgresSnapshotStore(pool),
      taskQueue: new InMemoryTaskQueue(),
      config: { snapshotInterval: 50 },
    });

    const state = await runtime2.loadCurrentState(workflowId, runId);
    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { ok: true });
  });
});
