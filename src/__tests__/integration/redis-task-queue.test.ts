import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";

import { RedisTaskQueue } from "../../infra/redis-task-queue";
import type { WorkflowTask } from "../../shared/tasks";
import { DefaultWorkflowEngine } from "../../core/default-engine";
import { InMemoryEventStore } from "../../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../../infra/inmemory-snapshot-store";
import { InMemoryWorkflowRuntime } from "../../infra/inmemory-workflow-runtime";
import { InMemoryTimerWorker } from "../../infra/inmemory-timer-worker";

const redisUrl = process.env.REDIS_URL?.trim();
const describeRedis = redisUrl ? describe : describe.skip;
const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describeRedis("RedisTaskQueue (REDIS_URL)", () => {
  let redis: Redis;
  let queue: RedisTaskQueue;

  before(async () => {
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: 2 });
    await redis.ping();
    queue = new RedisTaskQueue(redis, { keyPrefix: `ftn:test:${Date.now()}:` });
  });

  after(async () => {
    await redis.quit();
  });

  it("enqueue, lease y complete", async () => {
    const task: WorkflowTask = {
      id: `wf-it-${Date.now()}`,
      type: "workflow",
      workflowId: "w1",
      runId: "r1",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
    };

    await queue.enqueue(task);

    const lease = await queue.leaseNextTask("worker-1", "workflows", 10_000);
    assert.ok(lease);
    assert.equal(lease!.task.id, task.id);
    assert.equal(lease!.task.type, "workflow");

    await queue.completeTask(lease!.leaseId);

    const empty = await queue.leaseNextTask("worker-1", "workflows", 10_000);
    assert.equal(empty, null);
  });

  it("recoverStaleProcessing reencola tareas huérfanas en processing", async () => {
    const prefix = `ftn:test:recover-${Date.now()}:`;
    const q = new RedisTaskQueue(redis, { keyPrefix: prefix });

    const task: WorkflowTask = {
      id: `wf-orphan-${Date.now()}`,
      type: "workflow",
      workflowId: "w-orphan",
      runId: "r-orphan",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
    };
    const json = JSON.stringify(task);
    await redis.rpush(`${prefix}queue:workflows:processing`, json);

    const n = await q.recoverStaleProcessing("workflows", 60_000);
    assert.equal(n, 1);

    const lease = await q.leaseNextTask("worker-1", "workflows", 10_000);
    assert.ok(lease);
    assert.equal(lease!.task.id, task.id);
    await q.completeTask(lease!.leaseId);
  });

  it("recoverStaleProcessing no duplica tareas si ya existen en la cola principal", async () => {
    const prefix = `ftn:test:recover-dedup-${Date.now()}:`;
    const q = new RedisTaskQueue(redis, { keyPrefix: prefix });

    const task: WorkflowTask = {
      id: `wf-orphan-dedup-${Date.now()}`,
      type: "workflow",
      workflowId: "w-orphan-dedup",
      runId: "r-orphan-dedup",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
    };
    const json = JSON.stringify(task);
    await redis.rpush(`${prefix}queue:workflows:processing`, json);
    await redis.rpush(`${prefix}queue:workflows`, json);

    const recovered = await q.recoverStaleProcessing("workflows", 60_000);
    assert.equal(recovered, 1);

    const mainItems = await redis.lrange(`${prefix}queue:workflows`, 0, -1);
    assert.equal(mainItems.length, 1);

    const lease = await q.leaseNextTask("worker-1", "workflows", 10_000);
    assert.ok(lease);
    assert.equal(lease!.task.id, task.id);
    await q.completeTask(lease!.leaseId);
  });

  it("recovery tras reinicio: timer huérfano en processing se recupera y completa el workflow una sola vez", async () => {
    const prefix = `ftn:test:timer-recovery-${Date.now()}:`;
    const q = new RedisTaskQueue(redis, { keyPrefix: prefix });
    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();
    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      taskQueue: q,
      config: { snapshotInterval: 50 },
    });

    const { workflowId, runId } = await runtime.startWorkflow({
      workflowName: "redis-timer-recovery",
      input: {},
      definition: async (ftn) => {
        await ftn.sleep(0);
        return { ok: true };
      },
    });

    await runtime.runWorkflowTick(workflowId, runId);

    const leasedTimer = await q.leaseNextTask("timer-crashed-worker", "timers", 10_000);
    assert.ok(leasedTimer);
    assert.equal(leasedTimer!.task.type, "timer");

    await new Promise((resolve) => setTimeout(resolve, 2));
    const recoveredCount = await q.recoverStaleProcessing("timers", 0);
    assert.equal(recoveredCount, 1);

    const timerWorkerAfterRestart = new InMemoryTimerWorker({
      taskQueue: q,
      queueName: "timers",
      workflowQueueName: "workflows",
      pollIntervalMs: 10,
      log: silentLogger,
    });
    await timerWorkerAfterRestart.runOnce();

    const wfLease = await q.leaseNextTask("workflow-worker-after-restart", "workflows", 10_000);
    assert.ok(wfLease);
    assert.equal(wfLease!.task.type, "workflow");
    await runtime.runWorkflowTick(workflowId, runId);
    await q.completeTask(wfLease!.leaseId);

    const finalState = await runtime.loadCurrentState(workflowId, runId);
    assert.ok(finalState);
    assert.equal(finalState!.status, "completed");
    assert.deepEqual(finalState!.result, { ok: true });

    const stream = await eventStore.loadEvents(workflowId, runId, 0);
    assert.equal(stream.filter((event) => event.type === "WorkflowCompleted").length, 1);
  });
});
