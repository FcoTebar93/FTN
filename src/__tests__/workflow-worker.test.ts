import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
import { InMemoryActivityRegistry } from "../app/activities";
import { InMemoryActivityWorker } from "../infra/inmemory-activity-worker";
import { InMemoryWorkflowWorker } from "../infra/inmemory-workflow-worker";
import { getWorkflow } from "../app/workflows";
import { InMemoryTimerWorker } from "../infra/inmemory-timer-worker";

describe("InMemoryWorkflowWorker", () => {
    it("toma una WorkflowTask de la cola y ejecuta un tick que programa una actividad", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const taskQueue = new InMemoryTaskQueue();
    const activities = new InMemoryActivityRegistry();

    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    activities.register("echo-activity", async (input: { value: number }) => input);

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "echo-workflow",
      input: { value: 42 },
      definition: async (ftn, input) => {
        ftn.activity("echo-activity", input);
        return { done: true };
      },
    });

    await taskQueue.enqueue({
      id: `wf-task-${workflowId}-${runId}`,
      type: "workflow",
      workflowId,
      runId,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
    });

    const workflowWorker = new InMemoryWorkflowWorker({
      workerId: "workflow-worker-1",
      taskQueue,
      runtime,
      config: {
        queueName: "workflows",
        leaseTimeoutMs: 10_000,
        pollIntervalMs: 10,
      },
    });

    await workflowWorker.runOnce();

    const state = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state);
    assert.equal(state?.pendingActivities.length, 1);
    assert.equal(state?.pendingActivities[0].name, "echo-activity");

    const activityWorker = new InMemoryActivityWorker({
      taskQueue,
      activities,
      eventStore,
      snapshotStore,
      engine,
      activityQueueName: "activities",
    });

    await activityWorker.runOnce();

    await workflowWorker.runOnce();

    const nextLease = await taskQueue.leaseNextTask(
      "workflow-worker-1",
      "workflows",
      1000
    );
    assert.equal(nextLease, null);

    const finalState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(finalState);
    assert.equal(finalState?.pendingActivities.length, 0);
    assert.equal(finalState?.completedActivities.length, 1);
  });

  it("order-processing: retry en charge-payment y workflow completa", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const taskQueue = new InMemoryTaskQueue();
    const activities = new InMemoryActivityRegistry();

    activities.register("validate-order", async () => {});
    activities.register("create-shipment", async () => {});

    let chargeCalls = 0;
    activities.register("charge-payment", async () => {
      chargeCalls += 1;
      if (chargeCalls < 2) {
        throw new Error("Simulated payment gateway failure");
      }
    });

    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    const definition = getWorkflow("order-processing");
    assert.ok(definition, "order-processing workflow must be registered");

    const input = { orderId: "order-1", userId: "user-1", amount: 99.99 };
    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "order-processing",
      input,
      definition: definition!,
    });

    await taskQueue.enqueue({
      id: `wf-task-${workflowId}-${runId}`,
      type: "workflow",
      workflowId,
      runId,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
    });

    const workflowWorker = new InMemoryWorkflowWorker({
      workerId: "workflow-worker-1",
      taskQueue,
      runtime,
      config: {
        queueName: "workflows",
        leaseTimeoutMs: 10_000,
        pollIntervalMs: 10,
      },
    });

    const activityWorker = new InMemoryActivityWorker({
      taskQueue,
      activities,
      eventStore,
      snapshotStore,
      engine,
      activityQueueName: "activities",
    });

    const runActivityWorkerUntilIdle = async (maxRuns = 10) => {
      for (let i = 0; i < maxRuns; i++) {
        await activityWorker.runOnce();
      }
    };

    for (let i = 0; i < 5; i++) {
      await workflowWorker.runOnce();
      await runActivityWorkerUntilIdle();
    }

    const state = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state, "state must exist");
    assert.equal(state?.status, "completed", "workflow must complete after retry");
    assert.equal(chargeCalls, 2, "charge-payment must run twice (fail then succeed)");
  });

  it("ftn.sleep enqueues a TimerTask and TimeWorker creates a WorkflowTask", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const taskQueue = new InMemoryTaskQueue();

    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 }
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "sleep-workflow",
      input: {},
      definition: async (ftn) => {
        await ftn.sleep(1000);
        return { done: true };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);

    const timerWorker = new InMemoryTimerWorker({
      taskQueue,
      queueName: "timers",
      workflowQueueName: "workflows",
      pollIntervalMs: 10,
    });

    await timerWorker.runOnce();

    const nextLease = await taskQueue.leaseNextTask(
      "timer-worker-1",
      "timers",
      1000
    );
    
    assert.ok(nextLease, "must exist a workflow task after timer task is completed");
    assert.equal(nextLease!.task.type, "workflow");
    assert.equal(nextLease!.task.workflowId, workflowId);
    assert.equal(nextLease!.task.runId, runId);

    await taskQueue.completeTask(nextLease!.leaseId);
  });
});