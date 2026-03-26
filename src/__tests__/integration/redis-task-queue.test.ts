import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";

import { RedisTaskQueue } from "../../infra/redis-task-queue";
import type { WorkflowTask } from "../../shared/tasks";

const redisUrl = process.env.REDIS_URL?.trim();
const describeRedis = redisUrl ? describe : describe.skip;

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
});
