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

    // Registramos una actividad de ejemplo (para cerrar el ciclo luego si queremos)
    activities.register("echo-activity", async (input: { value: number }) => input);

    // Iniciamos un workflow que usa ftn.activity
    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "echo-workflow",
      input: { value: 42 },
      definition: async (ftn, input) => {
        ftn.activity("echo-activity", input);
        return { done: true };
      },
    });

    // Encolar manualmente una WorkflowTask para este workflow
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

    // Ejecutamos una vez el worker: debería consumir la WorkflowTask y hacer un tick
    await workflowWorker.runOnce();

    // Comprobamos que ya no hay WorkflowTasks pendientes
    const nextLease = await taskQueue.leaseNextTask(
      "workflow-worker-1",
      "workflows",
      1000
    );
    assert.equal(nextLease, null);

    // Estado del workflow: la actividad debería estar programada (pendingActivities)
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

    const finalState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(finalState);
    assert.equal(finalState?.pendingActivities.length, 0);
    assert.equal(finalState?.completedActivities.length, 1);
  });
});