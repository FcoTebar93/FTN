import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryTaskQueue } from "../infra/inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";
import { InMemoryWorkflowWorker } from "../infra/inmemory-workflow-worker";
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

function makeWorkflowTask(workflowId: string, runId: string) {
  return {
    id: `wf-task-${workflowId}-${runId}`,
    type: "workflow" as const,
    workflowId,
    runId,
    createdAt: new Date().toISOString(),
    scheduledAt: new Date().toISOString(),
    workerType: "workflow" as const,
    targetQueue: "workflows",
  };
}

describe("InMemoryWorkflowWorker", () => {
  it("toma una WorkflowTask de la cola y ejecuta un tick que programa una actividad", async () => {
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

    await taskQueue.enqueue(makeWorkflowTask(workflowId, runId));

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
    assert.equal(state!.pendingActivities.length, 1);
    assert.equal(state!.pendingActivities[0].name, "echo-activity");

    const activityRuntime = new DefaultActivityRuntime({ eventStore, snapshotStore, engine });
    const activityWorkerCore = new ActivityWorker(activities, activityRuntime);

    const lease = await taskQueue.leaseNextTask("activity-worker-1", "activities", 10000);
    assert.ok(lease);
    await activityWorkerCore.handleTask((lease.task as ActivityTask).payload);
    await taskQueue.completeTask(lease.leaseId);

    await workflowWorker.runOnce();

    const nextLease = await taskQueue.leaseNextTask("workflow-worker-1", "workflows", 1000);
    assert.equal(nextLease, null);

    const finalState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(finalState);
    assert.equal(finalState!.pendingActivities.length, 0);
    assert.equal(finalState!.completedActivities.length, 1);
  });

  it("workflow-worker y activity-worker completan un workflow con activities simples", async () => {
    const { runtime, eventStore, snapshotStore, engine, taskQueue } = inMemoryStack();
    const activities = new InMemoryActivityRegistry();

    activities.register({
      name: "noop-activity",
      async execute() {},
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "noop-workflow",
      input: {},
      definition: async (ftn) => {
        ftn.activity("noop-activity", {});
        return { done: true };
      },
    });

    await taskQueue.enqueue(makeWorkflowTask(workflowId, runId));

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

    const activityRuntime = new DefaultActivityRuntime({ eventStore, snapshotStore, engine });
    const activityWorkerCore = new ActivityWorker(activities, activityRuntime);

    const runActivityWorkerUntilIdle = async (maxRuns = 10) => {
      for (let i = 0; i < maxRuns; i++) {
        const lease = await taskQueue.leaseNextTask("activity-worker-1", "activities", 1000);
        if (!lease) return;
        await activityWorkerCore.handleTask((lease.task as ActivityTask).payload);
        await taskQueue.completeTask(lease.leaseId);
      }
    };

    for (let i = 0; i < 10; i++) {
      await workflowWorker.runOnce();
      await runActivityWorkerUntilIdle();
      const state = await runtime.loadCurrentState(workflowId, runId);
      if (state && state.status === "completed") {
        break;
      }
    }

    const finalState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(finalState);
    assert.equal(finalState!.status, "completed");
  });

  it("ftn.sleep encola TimerTask; TimerWorker encola WorkflowTask al vencer (sleep 0)", async () => {
    const { runtime, taskQueue } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "sleep-workflow",
      input: {},
      definition: async (ftn) => {
        await ftn.sleep(0);
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

    let wfLease = null;
    for (let i = 0; i < 15; i++) {
      await timerWorker.runOnce();
      wfLease = await taskQueue.leaseNextTask("workflow-worker-1", "workflows", 0);
      if (wfLease) break;
    }

    assert.ok(wfLease);
    assert.equal(wfLease.task.type, "workflow");
    assert.equal(wfLease.task.workflowId, workflowId);
    assert.equal(wfLease.task.runId, runId);
    await taskQueue.completeTask(wfLease.leaseId);
  });
});
