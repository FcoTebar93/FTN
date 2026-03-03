import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryActivityRegistry } from "../app/activities";
import { InMemoryActivityWorker } from "../infra/inmemory-activity-worker";

describe("InMemoryWorkflowRuntime", () => {
  it("inicia un workflow y reconstruye el estado básico", async () => {
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

    const { workflowId, runId, version } = await runtime.startWorkflow({
      workflowName: "example",
      input: { foo: "bar" },
      definition: async () => ({ ok: true }), // de momento no se usa en runWorkflowTick
    });

    assert.equal(version, 1);

    const tick = await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.equal(tick.state.id, workflowId);
    assert.equal(tick.state.runId, runId);
    assert.equal(tick.state.status, "running");
    assert.ok(state);
    assert.ok(state?.startedAt);
  });

  it("programa una actividad usando ftn.activity", async () => {
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
  
    assert.equal(tick.newEvents.length, 1);
    assert.equal(tick.newEvents[0].type, "ActivityScheduled");
  
    assert.ok(state);
    assert.equal(state?.pendingActivities.length, 1);
    assert.equal(state?.pendingActivities[0].name, "send-welcome-email");
  });

  it("programa una actividad y la encola en la task queue", async () => {
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

    assert.equal(tick.newEvents.length, 1);
    assert.equal(tick.newEvents[0].type, "ActivityScheduled");

    assert.ok(state);
    assert.equal(state?.pendingActivities.length, 1);
    assert.equal(state?.pendingActivities[0].name, "send-welcome-email");

    const lease = await taskQueue.leaseNextTask("worker-1", "activities", 10000);
    assert.ok(lease);
    assert.equal(lease?.task.type, "activity");
    assert.equal(lease?.task.activityName, "send-welcome-email");
  });

  it("ejecuta una actividad y mueve la actividad de pending a completed", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const taskQueue = new InMemoryTaskQueue();
    const activities = new InMemoryActivityRegistry();
  
    activities.register("echo-activity", async (input: { value: number }) => input);
  
    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
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

    const activityWorker = new InMemoryActivityWorker({
      taskQueue,
      activities,
      eventStore,
      snapshotStore,
      engine,
      activityQueueName: "activities",
    });

    await activityWorker.runOnce();

    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state?.pendingActivities.length, 0);
    assert.equal(state?.completedActivities.length, 1);
    assert.deepEqual(state?.completedActivities[0].result, { value: 42 });
  });

  it("ftn.sleep programa un TimerScheduled y añade un pendingTimer", async () => {
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
    assert.equal(tick.newEvents.length, 1);
    assert.equal(tick.newEvents[0].type, "TimerScheduled");
    assert.equal(state?.pendingTimers.length, 1);
  });
});