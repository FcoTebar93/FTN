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

interface BootstrapTaskQueueInput {
  log: Logger;
  redisUrl?: string;
  redisKeyPrefix?: string;
}

export function bootstrapTaskQueue(input: BootstrapTaskQueueInput): TaskQueueBootstrapResult {
  const { log, redisUrl, redisKeyPrefix } = input;
  let redis: Redis | undefined;
  let taskQueue: TaskQueue;
  let redisTaskQueue: RedisTaskQueue | undefined;
  if (redisUrl) {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
    const keyPrefix = redisKeyPrefix;
    redisTaskQueue = new RedisTaskQueue(redis, keyPrefix ? { keyPrefix } : {});
    taskQueue = redisTaskQueue;
    log.info("ftn.taskQueue", { backend: "redis" });
  } else {
    taskQueue = new InMemoryTaskQueue();
    log.info("ftn.taskQueue", { backend: "memory" });
  }

  return { redis, redisTaskQueue, taskQueue, redisUrl };
}
