import Redis from "ioredis";
import { InMemoryTaskQueue } from "../inmemory-task-queue";
import { RedisTaskQueue } from "../redis-task-queue";
import type { TaskQueue } from "../../modules/task-queue";
import type { Logger } from "../logger";

export interface TaskQueueBootstrapResult {
  redis: Redis | undefined;
  redisTaskQueue: RedisTaskQueue | undefined;
  taskQueue: TaskQueue;
  redisUrl: string | undefined;
}

export function bootstrapTaskQueue(log: Logger): TaskQueueBootstrapResult {
  let redis: Redis | undefined;
  let taskQueue: TaskQueue;
  let redisTaskQueue: RedisTaskQueue | undefined;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
    const keyPrefix = process.env.FTN_REDIS_KEY_PREFIX?.trim();
    redisTaskQueue = new RedisTaskQueue(redis, keyPrefix ? { keyPrefix } : {});
    taskQueue = redisTaskQueue;
    log.info("ftn.taskQueue", { backend: "redis" });
  } else {
    taskQueue = new InMemoryTaskQueue();
    log.info("ftn.taskQueue", { backend: "memory" });
  }

  return { redis, redisTaskQueue, taskQueue, redisUrl };
}
