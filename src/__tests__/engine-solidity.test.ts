import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
import { InMemoryTimerWorker } from "../infra/inmemory-timer-worker";
import { ConcurrencyError } from "../modules/event-store";
import { registerWorkflow } from "../app/workflows";

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

async function assertReplayConsistency(params: {
  engine: DefaultWorkflowEngine;
  eventStore: InMemoryEventStore;
  runtime: InMemoryWorkflowRuntime;
  workflowId: string;
  runId: string;
}) {
  const { engine, eventStore, runtime, workflowId, runId } = params;
  const loaded = await runtime.loadCurrentState(workflowId, runId);
  const stream = await eventStore.loadEvents(workflowId, runId, 0);
  const replayed = engine.replay(workflowId, runId, stream);
  assert.ok(loaded);
  assert.deepEqual(loaded, replayed.state);
}

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

class RecordingEventStore extends InMemoryEventStore {
  readonly loadFromVersions: number[] = [];

  async loadEvents(workflowId: string, runId: string, fromVersion?: number) {
    this.loadFromVersions.push(fromVersion ?? 0);
    return super.loadEvents(workflowId, runId, fromVersion);
  }
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

  it("loadCurrentState rehidrata usando snapshot.version como frontera de replay", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new RecordingEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const taskQueue = new InMemoryTaskQueue();
    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 3 },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "snapshot-boundary-check",
      input: {},
      definition: async (ftn) => {
        let sum = 0;
        for (let i = 0; i < 6; i++) {
          sum += await ftn.conditional(
            () => true,
            async () => 1,
            async () => 0
          );
        }
        return { sum };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const latestSnapshot = await snapshotStore.loadLatestSnapshot(workflowId, runId);
    assert.ok(latestSnapshot, "se esperaba snapshot tras superar snapshotInterval");

    eventStore.loadFromVersions.length = 0;
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.equal(eventStore.loadFromVersions[0], latestSnapshot!.version);

    const allEvents = await eventStore.loadEvents(workflowId, runId, 0);
    const fullReplay = engine.replay(workflowId, runId, allEvents);
    assert.deepEqual(state, fullReplay.state);
  });

  it("ticks repetidos sin señales nuevas no duplican SignalWaitStarted", async () => {
    const { runtime, eventStore } = stack(50);

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "signal-idempotent",
      input: {},
      definition: async (ftn) => {
        await ftn.signal("approval");
        return { ok: true };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    await runtime.runWorkflowTick(workflowId, runId);

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    const waits = events.filter(
      (event) =>
        event.type === "SignalWaitStarted" &&
        event.payload.signalName === "approval" &&
        event.payload.ordinal === 0
    );

    assert.equal(waits.length, 1);
  });

  it("child workflow en espera no duplica timer de polling ni ChildWorkflowStarted", async () => {
    const childWorkflowName = `child-suspend-${Date.now()}`;
    const parentWorkflowName = `parent-child-${Date.now()}`;

    registerWorkflow({
      name: childWorkflowName,
      version: "v1",
      displayName: "Child suspend test",
      definition: async (ftn) => {
        await ftn.signal("child-ready");
        return { child: "done" };
      },
    });

    registerWorkflow({
      name: parentWorkflowName,
      version: "v1",
      displayName: "Parent child test",
      definition: async (ftn) => {
        await ftn.child(childWorkflowName, {});
        return { parent: "done" };
      },
    });

    const { runtime, eventStore } = stack(50);
    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: parentWorkflowName,
      workflowVersion: "v1",
      input: {},
      definition: async (ftn) => {
        await ftn.child(childWorkflowName, {});
        return { parent: "done" };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    await runtime.runWorkflowTick(workflowId, runId);

    const parentEvents = await eventStore.loadEvents(workflowId, runId, 0);
    const childStarts = parentEvents.filter((event) => event.type === "ChildWorkflowStarted");
    const childPollTimers = parentEvents.filter(
      (event) =>
        event.type === "TimerScheduled" &&
        event.payload.retryBackoff?.stepId === "child-0" &&
        event.payload.retryBackoff?.afterAttempt === 0
    );

    assert.equal(childStarts.length, 1);
    assert.equal(childPollTimers.length, 1);
  });

  it("determinismo extremo: retry + child + signal mantiene equivalencia snapshot/replay", async () => {
    const childWorkflowName = `det-child-${Date.now()}`;
    const parentWorkflowName = `det-parent-${Date.now()}`;
    let parentRetryCalls = 0;
    registerWorkflow({
      name: childWorkflowName,
      version: "v1",
      displayName: "Determinism child",
      definition: async (ftn) => {
        const payload = await ftn.signal<{ base: number }>("child-go");
        return { value: payload.base * 2 };
      },
    });
    registerWorkflow({
      name: parentWorkflowName,
      version: "v1",
      displayName: "Determinism parent",
      definition: async (ftn) => {
        await ftn.retry(
          { maxAttempts: 2, backOffMs: 1 },
          async () => {
            parentRetryCalls += 1;
            if (parentRetryCalls === 1) {
              throw new Error("fail-once");
            }
            return "ok";
          }
        );
        const child = await ftn.child<{ seed: number }, { value: number }>(childWorkflowName, { seed: 21 });
        const approval = await ftn.signal<{ delta: number }>("parent-approval");
        return { total: child.value + approval.delta };
      },
    });

    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const taskQueue = new InMemoryTaskQueue();
    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 2 },
    });
    const timerWorker = new InMemoryTimerWorker({
      taskQueue,
      queueName: "timers",
      workflowQueueName: "workflows",
      pollIntervalMs: 1,
      log: silentLogger,
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: parentWorkflowName,
      workflowVersion: "v1",
      input: {},
      definition: async (ftn) => {
        await ftn.retry(
          { maxAttempts: 2, backOffMs: 1 },
          async () => {
            parentRetryCalls += 1;
            if (parentRetryCalls === 1) throw new Error("fail-once");
            return "ok";
          }
        );
        const child = await ftn.child<{ seed: number }, { value: number }>(childWorkflowName, { seed: 21 });
        const approval = await ftn.signal<{ delta: number }>("parent-approval");
        return { total: child.value + approval.delta };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    await assertReplayConsistency({ engine, eventStore, runtime, workflowId, runId });

    for (let i = 0; i < 20; i++) {
      await timerWorker.runOnce();
      const maybeTask = await taskQueue.leaseNextTask("wf-1", "workflows", 1);
      if (maybeTask) {
        await taskQueue.completeTask(maybeTask.leaseId);
        break;
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    await runtime.runWorkflowTick(workflowId, runId);
    await assertReplayConsistency({ engine, eventStore, runtime, workflowId, runId });

    const parentEventsAfterChildStart = await eventStore.loadEvents(workflowId, runId, 0);
    const childStarted = parentEventsAfterChildStart.find(
      (event): event is Extract<(typeof parentEventsAfterChildStart)[number], { type: "ChildWorkflowStarted" }> =>
        event.type === "ChildWorkflowStarted"
    );
    assert.ok(childStarted);
    const childWorkflowId = childStarted.payload.childWorkflowId;
    const childRunId = childStarted.payload.childRunId;

    await runtime.runWorkflowTick(childWorkflowId, childRunId);
    await assertReplayConsistency({
      engine,
      eventStore,
      runtime,
      workflowId: childWorkflowId,
      runId: childRunId,
    });

    const childEvents = await eventStore.loadEvents(childWorkflowId, childRunId, 0);
    const childLastVersion = childEvents[childEvents.length - 1]!.version;
    await eventStore.appendEvents(childWorkflowId, childRunId, childLastVersion, [
      {
        type: "SignalReceived",
        workflowId: childWorkflowId,
        runId: childRunId,
        payload: { signalName: "child-go", data: { base: 20 } },
      },
    ]);
    await runtime.runWorkflowTick(childWorkflowId, childRunId);
    await assertReplayConsistency({
      engine,
      eventStore,
      runtime,
      workflowId: childWorkflowId,
      runId: childRunId,
    });

    await runtime.runWorkflowTick(workflowId, runId);
    await assertReplayConsistency({ engine, eventStore, runtime, workflowId, runId });

    const parentEventsBeforeFinal = await eventStore.loadEvents(workflowId, runId, 0);
    const parentLastVersion = parentEventsBeforeFinal[parentEventsBeforeFinal.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, parentLastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "parent-approval", data: { delta: 2 } },
      },
    ]);

    await runtime.runWorkflowTick(workflowId, runId);
    const finalState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(finalState);
    assert.equal(finalState.status, "completed");
    assert.deepEqual(finalState.result, { total: 42 });
    await assertReplayConsistency({ engine, eventStore, runtime, workflowId, runId });
  });
});
