import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
import { InMemoryTimerWorker } from "../infra/inmemory-timer-worker";
import { InMemoryActivityRegistry } from "../modules/activity-registry/inmemory-activity-registry";
import { ActivityWorker } from "../workers/activity-worker";
import { DefaultActivityRuntime } from "../modules/activity-runtime";
import type { ActivityTask } from "../shared/tasks";

function inMemoryStack() {
  const engine = new DefaultWorkflowEngine();
  const eventStore = new InMemoryEventStore();
  const snapshotStore = new InMemorySnapshotStore();
  const taskQueue = new InMemoryTaskQueue();
  const runtime = new InMemoryWorkflowRuntime({
    engine,
    eventStore,
    snapshotStore,
    taskQueue,
    config: { snapshotInterval: 50 },
  });
  return { engine, eventStore, snapshotStore, taskQueue, runtime };
}

describe("InMemoryWorkflowRuntime", () => {
  it("completa un workflow simple y guarda el resultado", async () => {
    const { runtime } = inMemoryStack();

    const { workflowId, runId, version } = await runtime.startWorkflow({
      workflowName: "example",
      input: { x: 1 },
      definition: async (_ftn, input) => ({ sum: input.x + 1 }),
    });

    assert.equal(version, 1);

    const tick = await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(tick.state.id, workflowId);
    assert.equal(tick.state.runId, runId);
    assert.equal(tick.state.status, "completed");
    assert.deepEqual(state!.result, { sum: 2 });
  });

  it("persiste workflowVersion en WorkflowStarted para congelar definición del run", async () => {
    const { runtime, eventStore } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "example-versioned",
      workflowVersion: "v2",
      input: { x: 1 },
      definition: async (_ftn, input) => ({ sum: input.x + 1 }),
    });

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    assert.equal(events[0].type, "WorkflowStarted");
    assert.equal(events[0].payload.workflowVersion, "v2");
  });

  it("programa una ActivityScheduled usando ftn.activity y la deja en pendingActivities", async () => {
    const { runtime } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "send-email",
      input: { userId: "u1", email: "test@example.com" },
      definition: async (ftn, input) => {
        ftn.activity("send-welcome-email", input);
        return { ok: true };
      },
    });

    const tick = await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(tick.newEvents.length, 1);
    assert.equal(tick.newEvents[0].type, "ActivityScheduled");
    assert.equal(state!.pendingActivities.length, 1);
    assert.equal(state!.pendingActivities[0].name, "send-welcome-email");
  });

  it("integra ActivityWorker para ejecutar una actividad y moverla a completed", async () => {
    const { runtime, eventStore, snapshotStore, engine, taskQueue } = inMemoryStack();
    const activities = new InMemoryActivityRegistry();

    activities.register({
      name: "echo-activity",
      async execute(input: { value: number }) {
        return input;
      },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "echo-workflow",
      input: { value: 42 },
      definition: async (ftn, input) => {
        ftn.activity("echo-activity", input);
        return { done: true };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);

    const activityRuntime = new DefaultActivityRuntime({ eventStore, snapshotStore, engine });
    const activityWorkerCore = new ActivityWorker(activities, activityRuntime);

    const lease = await taskQueue.leaseNextTask("activity-worker-1", "activities", 10000);
    assert.ok(lease);
    await activityWorkerCore.handleTask((lease.task as ActivityTask).payload);
    await taskQueue.completeTask(lease.leaseId);

    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.pendingActivities.length, 0);
    assert.equal(state!.completedActivities.length, 1);
    assert.deepEqual(state!.completedActivities[0].result, { value: 42 });
  });

  it("ftn.sleep emite TimerScheduled y encola un TimerTask", async () => {
    const { runtime, taskQueue } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "sleep-workflow",
      input: {},
      definition: async (ftn) => {
        await ftn.sleep(1000);
        return { done: true };
      },
    });

    const tick = await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);

    const timerEvents = tick.newEvents.filter((e) => e.type === "TimerScheduled");
    assert.equal(timerEvents.length, 1);

    const timerLease = await taskQueue.leaseNextTask("timer-worker-1", "timers", 1000);
    assert.ok(timerLease);
    assert.equal(timerLease.task.type, "timer");
    assert.equal(timerLease.task.workflowId, workflowId);
    assert.equal(timerLease.task.runId, runId);
  });

  it("ftn.conditional devuelve la rama then cuando flag es true", async () => {
    const { runtime } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "conditional-test",
      input: { flag: true },
      definition: async (ftn, input: { flag: boolean }) => {
        return ftn.conditional(
          () => input.flag,
          async () => "then-branch",
          async () => "else-branch"
        );
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.equal(state!.result, "then-branch");
  });

  it("ftn.signal suspende hasta SignalReceived y luego completa", async () => {
    const { runtime, eventStore } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "signal-wait",
      input: {},
      definition: async (ftn) => {
        const data = await ftn.signal<{ x: number }>("my-signal");
        return { ok: true, value: data.x };
      },
    });

    const tick1 = await runtime.runWorkflowTick(workflowId, runId);
    const state1 = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state1);
    assert.equal(state1!.status, "running");
    assert.equal(tick1.newEvents.length, 1);
    assert.equal(tick1.newEvents[0].type, "SignalWaitStarted");
    assert.equal(state1!.pendingSignalWaits.length, 1);
    assert.equal(state1!.pendingSignalWaits[0].signalName, "my-signal");

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    const lastVersion = stream[stream.length - 1]!.version;

    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "my-signal", data: { x: 42 } },
      },
    ]);

    await runtime.runWorkflowTick(workflowId, runId);
    const state2 = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state2);
    assert.equal(state2!.status, "completed");
    assert.deepEqual(state2!.result, { ok: true, value: 42 });
    assert.equal(state2!.pendingSignalWaits.length, 0);
  });

  it("ftn.retry registra RetryAttemptStarted y reintenta hasta tener éxito", async () => {
    const { runtime, eventStore } = inMemoryStack();

    let calls = 0;

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "retry-success",
      input: {},
      definition: async (ftn) => {
        return ftn.retry(
          { maxAttempts: 3, backOffMs: 0 },
          async () => {
            calls += 1;
            if (calls < 2) {
              throw new Error("fail once");
            }
            return "ok";
          }
        );
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    const retryEvents = events.filter((e) => e.type === "RetryAttemptStarted");
    const giveUpEvents = events.filter((e) => e.type === "RetryGivenUp");
    const completedRetry = events.filter((e) => e.type === "RetryCompleted");

    assert.ok(calls >= 2);
    assert.ok(retryEvents.length >= 1);
    assert.equal(giveUpEvents.length, 0);
    assert.ok(completedRetry.length >= 1);
  });

  it("ftn.retry con backOffMs programa TimerScheduled (retryBackoff) y completa tras el timer", async () => {
    const { runtime, taskQueue } = inMemoryStack();

    let calls = 0;

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "retry-backoff",
      input: {},
      definition: async (ftn) => {
        return ftn.retry(
          { maxAttempts: 3, backOffMs: 5 },
          async () => {
            calls += 1;
            if (calls < 2) {
              throw new Error("fail once");
            }
            return "ok";
          }
        );
      },
    });

    const tick1 = await runtime.runWorkflowTick(workflowId, runId);
    const state1 = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state1);
    assert.equal(state1!.status, "running");
    assert.ok(
      tick1.newEvents.some(
        (e) =>
          e.type === "TimerScheduled" &&
          e.payload.retryBackoff !== undefined &&
          e.payload.retryBackoff.afterAttempt === 1
      )
    );

    const timerWorker = new InMemoryTimerWorker({
      taskQueue,
      queueName: "timers",
      workflowQueueName: "workflows",
      pollIntervalMs: 5,
    });

    let advanced = false;
    for (let i = 0; i < 40; i++) {
      await timerWorker.runOnce();
      await new Promise((r) => setTimeout(r, 3));
      const lease = await taskQueue.leaseNextTask("workflow-worker-1", "workflows", 0);
      if (lease) {
        await taskQueue.completeTask(lease.leaseId);
        await runtime.runWorkflowTick(workflowId, runId);
        advanced = true;
        break;
      }
    }

    assert.ok(advanced);

    const state2 = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state2);
    assert.equal(state2!.status, "completed");
    assert.equal(state2!.result, "ok");
  });
});
