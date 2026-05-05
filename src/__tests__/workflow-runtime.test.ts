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
import type { ActivityTask, TimerTask } from "../shared/tasks";
import type { Logger } from "../infra/logger";
import { getWorkflow, getWorkflowDescriptor, listWorkflowVersions, registerWorkflow } from "../app/workflows";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function inMemoryStack(snapshotInterval = 50) {
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
  return { engine, eventStore, snapshotStore, taskQueue, runtime };
}

describe("InMemoryWorkflowRuntime", () => {
  it("catálogo versionado: resuelve versión específica y latest por nombre", async () => {
    const baseName = `catalog-versioned-${Date.now()}`;
    registerWorkflow({
      name: baseName,
      version: "v1",
      displayName: "Catalog v1",
      definition: async () => ({ version: "v1" }),
    });
    registerWorkflow({
      name: baseName,
      version: "v2",
      displayName: "Catalog v2",
      definition: async () => ({ version: "v2" }),
    });

    const latest = getWorkflowDescriptor(baseName);
    const v1 = getWorkflowDescriptor(baseName, "v1");
    const versions = listWorkflowVersions(baseName);

    assert.equal(latest?.version, "v2");
    assert.equal(v1?.version, "v1");
    assert.equal(typeof getWorkflow(baseName, "v1"), "function");
    assert.deepEqual(versions.map((item) => item.version), ["v1", "v2"]);
  });

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

  it("mantiene un run antiguo en v1 aunque ya exista v2 en el catálogo", async () => {
    const { engine, eventStore, snapshotStore, taskQueue, runtime } = inMemoryStack();
    const workflowName = `versioned-run-${Date.now()}`;

    registerWorkflow<{ offset: number }, { total: number }>({
      name: workflowName,
      version: "v1",
      displayName: "Versioned workflow v1",
      definition: async (ftn, input) => {
        const data = await ftn.signal<{ base: number }>("resume");
        return { total: data.base + input.offset };
      },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName,
      workflowVersion: "v1",
      input: { offset: 2 },
      definition: async (ftn, input: { offset: number }) => {
        const data = await ftn.signal<{ base: number }>("resume");
        return { total: data.base + input.offset };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);

    registerWorkflow<{ offset: number }, { total: number }>({
      name: workflowName,
      version: "v2",
      displayName: "Versioned workflow v2",
      definition: async (ftn, input) => {
        const data = await ftn.signal<{ base: number }>("resume");
        return { total: data.base + input.offset + 1000 };
      },
    });

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    const lastVersion = stream[stream.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "resume", data: { base: 40 } },
      },
    ]);

    const runtimeAfterRestart = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    await runtimeAfterRestart.runWorkflowTick(workflowId, runId);
    const state = await runtimeAfterRestart.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { total: 42 });
  });

  it("falla de forma explícita si falta la versión requerida para reanudar un run", async () => {
    const { engine, eventStore, snapshotStore, taskQueue, runtime } = inMemoryStack();
    const workflowName = `missing-version-${Date.now()}`;

    registerWorkflow<{ offset: number }, { total: number }>({
      name: workflowName,
      version: "v1",
      displayName: "Missing version v1",
      definition: async (ftn, input) => {
        const data = await ftn.signal<{ base: number }>("resume");
        return { total: data.base + input.offset };
      },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName,
      workflowVersion: "v3",
      input: { offset: 2 },
      definition: async (ftn, input: { offset: number }) => {
        const data = await ftn.signal<{ base: number }>("resume");
        return { total: data.base + input.offset };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    const lastVersion = stream[stream.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "resume", data: { base: 40 } },
      },
    ]);

    const runtimeAfterRestart = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    await assert.rejects(
      () => runtimeAfterRestart.runWorkflowTick(workflowId, runId),
      /Workflow definition not available/
    );
  });

  it("persiste tenantId en WorkflowStarted cuando se aporta en startWorkflow", async () => {
    const { runtime, eventStore } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "example-tenant",
      workflowVersion: "v1",
      tenantId: "tenant-acme",
      input: {},
      definition: async () => ({ ok: true }),
    });

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    assert.equal(events[0].type, "WorkflowStarted");
    assert.equal(events[0].payload.tenantId, "tenant-acme");
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

  it("propaga correlationId del tick a ActivityTask encolado", async () => {
    const { runtime, taskQueue } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "corr-act-only",
      input: {},
      definition: async (ftn) => {
        ftn.activity("noop-corr", {});
        return {};
      },
    });

    await runtime.runWorkflowTick(workflowId, runId, { correlationId: "corr-act-1" });

    const actLease = await taskQueue.leaseNextTask("w", "activities", 1);
    assert.ok(actLease);
    const aq = actLease.task as ActivityTask;
    assert.equal(aq.correlationId, "corr-act-1");
    assert.equal(aq.payload.correlationId, "corr-act-1");
    await taskQueue.completeTask(actLease.leaseId);
  });

  it("propaga correlationId del tick a TimerTask encolado", async () => {
    const { runtime, taskQueue } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "corr-timer-only",
      input: {},
      definition: async (ftn) => {
        await ftn.sleep(1000);
        return {};
      },
    });

    await runtime.runWorkflowTick(workflowId, runId, { correlationId: "corr-timer-1" });

    const timerLease = await taskQueue.leaseNextTask("w", "timers", 1);
    assert.ok(timerLease);
    assert.equal((timerLease.task as TimerTask).correlationId, "corr-timer-1");
    await taskQueue.completeTask(timerLease.leaseId);
  });

  it("integra ActivityWorker para ejecutar una actividad y moverla a completed", async () => {
    const { runtime, eventStore, snapshotStore, engine, taskQueue } = inMemoryStack();
    const activities = new InMemoryActivityRegistry();

    activities.register({
      name: "echo-activity",
      async execute(input: { value: number }, _ctx) {
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

  it("recupera la definición desde el catálogo al reanudar con otra instancia runtime", async () => {
    const { engine, eventStore, snapshotStore, taskQueue, runtime } = inMemoryStack();
    const workflowName = `signal-catalog-recovery-${Date.now()}`;

    registerWorkflow<{ expected: number }, { resumed: number }>({
      name: workflowName,
      version: "v1",
      displayName: "Signal catalog recovery",
      definition: async (ftn, input) => {
        const data = await ftn.signal<{ value: number }>("resume");
        return { resumed: data.value + input.expected };
      },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName,
      workflowVersion: "v1",
      input: { expected: 8 },
      definition: async (ftn, input: { expected: number }) => {
        const data = await ftn.signal<{ value: number }>("resume");
        return { resumed: data.value + input.expected };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    const lastVersion = stream[stream.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "resume", data: { value: 34 } },
      },
    ]);

    const runtimeAfterRestart = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 50 },
    });

    await runtimeAfterRestart.runWorkflowTick(workflowId, runId);
    const state = await runtimeAfterRestart.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { resumed: 42 });
  });

  it("reanuda correctamente desde snapshot con otra instancia runtime", async () => {
    const { engine, eventStore, snapshotStore, taskQueue, runtime } = inMemoryStack(1);
    const workflowName = `snapshot-recovery-${Date.now()}`;

    registerWorkflow<{ offset: number }, { total: number }>({
      name: workflowName,
      version: "v1",
      displayName: "Snapshot recovery workflow",
      definition: async (ftn, input) => {
        const data = await ftn.signal<{ base: number }>("resume-from-snapshot");
        return { total: data.base + input.offset };
      },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName,
      workflowVersion: "v1",
      input: { offset: 2 },
      definition: async (ftn, input: { offset: number }) => {
        const data = await ftn.signal<{ base: number }>("resume-from-snapshot");
        return { total: data.base + input.offset };
      },
    });

    const firstTick = await runtime.runWorkflowTick(workflowId, runId);
    assert.equal(firstTick.snapshotCreated, true);

    const snapshot = await snapshotStore.loadLatestSnapshot(workflowId, runId);
    assert.ok(snapshot);

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    const lastVersion = stream[stream.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "SignalReceived",
        workflowId,
        runId,
        payload: { signalName: "resume-from-snapshot", data: { base: 40 } },
      },
    ]);

    const runtimeAfterRestart = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue,
      config: { snapshotInterval: 1 },
    });

    await runtimeAfterRestart.runWorkflowTick(workflowId, runId);
    const state = await runtimeAfterRestart.loadCurrentState(workflowId, runId);

    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { total: 42 });
  });

  it("cancelación explícita: WorkflowCancelRequested termina el run en cancelled y limpia pendientes", async () => {
    const { runtime, eventStore } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "cancel-me",
      input: {},
      definition: async (ftn) => {
        ftn.activity("some-activity", {});
        await ftn.sleep(60_000);
        return { done: true };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const beforeCancel = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(beforeCancel);
    assert.ok((beforeCancel!.pendingActivities.length + beforeCancel!.pendingTimers.length) > 0);

    const eventsBefore = await eventStore.loadEvents(workflowId, runId, 0);
    const lastVersion = eventsBefore[eventsBefore.length - 1]!.version;
    await eventStore.appendEvents(workflowId, runId, lastVersion, [
      {
        type: "WorkflowCancelRequested",
        workflowId,
        runId,
        payload: { reason: "user-request", requestedBy: "tester" },
      },
    ]);

    const tick = await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state);
    assert.equal(tick.newEvents.some((e) => e.type === "WorkflowCancelled"), true);
    assert.equal(state!.status, "cancelled");
    assert.equal(state!.cancellationReason, "user-request");
    assert.equal(state!.cancellationRequestedBy, "tester");
    assert.equal(state!.pendingActivities.length, 0);
    assert.equal(state!.pendingTimers.length, 0);
    assert.equal(state!.pendingSignalWaits.length, 0);
  });

  it("ftn.child inicia workflow hijo y propaga su resultado al padre", async () => {
    const { runtime, taskQueue, eventStore } = inMemoryStack();

    registerWorkflow<{ value: number }, { doubled: number }>({
      name: "child-inline-test",
      version: "v1",
      displayName: "Child inline test",
      definition: async (_ftn, input) => ({ doubled: input.value * 2 }),
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "parent-inline-test",
      input: {},
      definition: async (ftn) => {
        const childResult = await ftn.child<{ value: number }, { doubled: number }>("child-inline-test", { value: 21 });
        return { ok: true, child: childResult };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId, { correlationId: "corr-child-test" });

    const childLease = await taskQueue.leaseNextTask("workflow-worker-child", "workflows", 1000);
    assert.ok(childLease);
    assert.equal(childLease.task.type, "workflow");
    const childWorkflowId = childLease.task.workflowId;
    const childRunId = childLease.task.runId;
    await runtime.runWorkflowTick(childWorkflowId, childRunId);
    await taskQueue.completeTask(childLease.leaseId);

    await runtime.runWorkflowTick(workflowId, runId);
    await runtime.runWorkflowTick(workflowId, runId);

    const parentState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(parentState);
    assert.equal(parentState!.status, "completed");
    assert.deepEqual(parentState!.result, { ok: true, child: { doubled: 42 } });

    const parentEvents = await eventStore.loadEvents(workflowId, runId, 0);
    assert.ok(parentEvents.some((e) => e.type === "ChildWorkflowStarted"));
    assert.ok(parentEvents.some((e) => e.type === "ChildWorkflowCompleted"));
  });

  it("ftn.forEach recorre elementos con límite y registra eventos de loop", async () => {
    const { runtime, eventStore } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "loop-basic",
      input: { nums: [1, 2, 3] },
      definition: async (ftn, input: { nums: number[] }) => {
        const doubled = await ftn.forEach(input.nums, async (n) => n * 2, { maxIterations: 10 });
        return { doubled };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state);
    assert.equal(state!.status, "completed");
    assert.deepEqual(state!.result, { doubled: [2, 4, 6] });

    const events = await eventStore.loadEvents(workflowId, runId, 0);
    assert.ok(events.some((e) => e.type === "LoopIterationStarted"));
    assert.ok(events.some((e) => e.type === "LoopCompleted"));
  });

  it("ftn.forEach falla cuando supera maxIterations", async () => {
    const { runtime } = inMemoryStack();

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "loop-limit",
      input: { nums: [1, 2, 3] },
      definition: async (ftn, input: { nums: number[] }) => {
        await ftn.forEach(input.nums, async (n) => n, { maxIterations: 2 });
        return { ok: true };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(state);
    assert.equal(state!.status, "failed");
    assert.equal((state!.failureReason ?? "").includes("Loop iteration limit exceeded"), true);
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
      log: silentLogger,
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
