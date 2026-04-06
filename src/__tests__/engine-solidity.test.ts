import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
import { ConcurrencyError } from "../modules/event-store";

function stack(snapshotInterval: number) {
  const engine = new DefaultWorkflowEngine();
  const eventStore = new InMemoryEventStore();
  const snapshotStore = new InMemorySnapshotStore();
  const taskQueue = new InMemoryTaskQueue();
  const runtime = new InMemoryWorkflowRuntime({
    engine,
    eventStore,
    snapshotStore,
    taskQueue,
    config: { snapshotInterval },
  });
  return { engine, eventStore, snapshotStore, runtime };
}

function seededBool(seed: number, index: number): boolean {
  const n = (seed * 1664525 + 1013904223 + index * 1103515245) >>> 0;
  return (n & 1) === 0;
}

describe("Solidez del motor (concurrencia lógica + snapshot/replay)", () => {
  it("dos runWorkflowTick en paralelo: solo uno hace append; el otro recibe ConcurrencyError", async () => {
    const { runtime, eventStore } = stack(50);

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "race-complete",
      input: {},
      definition: async () => ({ done: true }),
    });

    const results = await Promise.allSettled([
      runtime.runWorkflowTick(workflowId, runId),
      runtime.runWorkflowTick(workflowId, runId),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const err = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(err.length, 1);
    assert.ok(err[0]!.status === "rejected");
    if (err[0]!.status === "rejected") {
      assert.ok(err[0]!.reason instanceof ConcurrencyError);
    }

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    const completed = events.filter((e) => e.type === "WorkflowCompleted");
    assert.equal(completed.length, 1);

    const state = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { done: true });
  });

  it("tras snapshot, loadCurrentState coincide con replay del historial completo", async () => {
    const { engine, eventStore, snapshotStore, runtime } = stack(5);

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "many-conditionals",
      input: {},
      definition: async (ftn) => {
        let acc = 0;
        for (let i = 0; i < 8; i++) {
          acc += await ftn.conditional(
            () => true,
            async () => 1,
            async () => 0
          );
        }
        return { acc };
      },
    });

    const tick = await runtime.runWorkflowTick(workflowId, runId);

    assert.ok(tick.snapshotCreated, "debe crearse snapshot al superar snapshotInterval");
    const snap = await snapshotStore.loadLatestSnapshot(workflowId, runId);
    assert.ok(snap);
    assert.ok(snap!.version >= 5);

    const allEvents = await eventStore.loadEvents(workflowId, runId, 0);
    const fromReplay = engine.replay(workflowId, runId, allEvents, undefined);
    const fromLoad = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(fromLoad);
    assert.deepEqual(fromLoad, fromReplay.state);
  });

  it("estrés determinista: múltiples seeds mantienen equivalencia snapshot/replay", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { engine, eventStore, runtime } = stack(3);

      const { workflowId, runId } = await runtime.startWorkflow({
        workflowName: `seed-${seed}`,
        input: { seed },
        definition: async (ftn) => {
          let acc = 0;
          const steps = 6 + (seed % 5);
          for (let i = 0; i < steps; i++) {
            const val = await ftn.conditional(
              () => seededBool(seed, i),
              async () => 2,
              async () => 1
            );
            acc += val;
          }
          return { seed, acc };
        },
      });

      await runtime.runWorkflowTick(workflowId, runId);

      const stateFromLoad = await runtime.loadCurrentState(workflowId, runId);
      assert.ok(stateFromLoad);
      assert.equal(stateFromLoad!.status, "completed");

      const allEvents = await eventStore.loadEvents(workflowId, runId, 0);
      const replayed = engine.replay(workflowId, runId, allEvents);
      assert.deepEqual(stateFromLoad, replayed.state);
    }
  });
});
