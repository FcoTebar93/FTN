import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
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

    assert.ok(calls >= 2);
    assert.ok(retryEvents.length >= 1);
    assert.equal(giveUpEvents.length, 0);
  });
});
