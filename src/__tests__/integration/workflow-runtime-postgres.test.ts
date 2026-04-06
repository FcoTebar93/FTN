import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { DefaultWorkflowEngine } from "../../core/default-engine";
import { InMemoryTaskQueue } from "../../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../../infra/inmemory-workflow-runtime";
import { runPostgresMigrations } from "../../infra/postgres-migrations";
import { PostgresEventStore } from "../../infra/postgres-event-store";
import { PostgresSnapshotStore } from "../../infra/postgres-snapshot-store";
import { ConcurrencyError } from "../../modules/event-store";

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

  it("signal: SignalWaitStarted en historial y completado tras SignalReceived", async () => {
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
      workflowName: "pg-signal",
      input: {},
      definition: async (ftn) => {
        const data = await ftn.signal<{ v: number }>("s");
        return { v: data.v };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const state1 = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state1);
    assert.equal(state1!.status, "running");
    assert.ok(state1!.pendingSignalWaits.length >= 1);

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    assert.ok(stream.some((e) => e.type === "SignalWaitStarted"));

    const lastVersion = stream[stream.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "s", data: { v: 7 } },
      },
    ]);

    await runtime.runWorkflowTick(workflowId, runId);
    const state2 = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state2);
    assert.equal(state2!.status, "completed");
    assert.deepEqual(state2!.result, { v: 7 });
    assert.equal(state2!.pendingSignalWaits.length, 0);
  });

  it("dos runWorkflowTick concurrentes: un append gana y el otro lanza ConcurrencyError (Postgres)", async () => {
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
      workflowName: "pg-race",
      input: {},
      definition: async () => ({ done: true }),
    });

    const results = await Promise.allSettled([
      runtime.runWorkflowTick(workflowId, runId),
      runtime.runWorkflowTick(workflowId, runId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    if (rejected[0]!.status === "rejected") {
      assert.ok(rejected[0]!.reason instanceof ConcurrencyError);
    }

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    assert.equal(events.filter((e) => e.type === "WorkflowCompleted").length, 1);
  });
});
