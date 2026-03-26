import type Redis from "ioredis";
import type { TaskQueue } from "../modules/task-queue";
import type { Task, TaskLease } from "../shared/tasks";
import type { WorkerId } from "../shared/types";

export interface RedisTaskQueueOptions {
  keyPrefix?: string;
}

interface LeaseStored {
  taskJson: string;
  workerId: WorkerId;
  leasedAt: string;
}

export class RedisTaskQueue implements TaskQueue {
  constructor(
    private readonly redis: Redis,
    private readonly options: RedisTaskQueueOptions = {}
  ) {}

  private prefix(): string {
    return this.options.keyPrefix ?? "ftn:";
  }

  private queueKey(queueName: string): string {
    return `${this.prefix()}queue:${queueName}`;
  }

  private processingKey(queueName: string): string {
    return `${this.prefix()}queue:${queueName}:processing`;
  }

  private leaseDataKey(leaseId: string): string {
    return `${this.prefix()}lease:${leaseId}`;
  }

  private leaseByTaskKey(taskId: string): string {
    return `${this.prefix()}lease:bytask:${taskId}`;
  }

  async enqueue(task: Task): Promise<void> {
    await this.redis.rpush(this.queueKey(task.targetQueue), JSON.stringify(task));
  }

  async leaseNextTask(
    workerId: WorkerId,
    queueName: string,
    leaseTimeoutMs: number
  ): Promise<TaskLease | null> {
    const main = this.queueKey(queueName);
    const processing = this.processingKey(queueName);

    const raw = await this.redis.lmove(main, processing, "LEFT", "RIGHT");
    if (raw == null || raw === "") {
      return null;
    }

    const task = JSON.parse(raw) as Task;
    const leaseId = `${task.id}:${Date.now()}`;
    const lease: TaskLease = {
      task,
      workerId,
      leaseId,
      leasedAt: new Date().toISOString(),
      leaseTimeoutMs,
    };

    const ttlSec = Math.max(300, Math.ceil(leaseTimeoutMs / 1000) * 2);
    const payload: LeaseStored = {
      taskJson: raw,
      workerId,
      leasedAt: lease.leasedAt,
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(this.leaseDataKey(leaseId), JSON.stringify(payload), "EX", ttlSec);
    pipeline.set(this.leaseByTaskKey(task.id), leaseId, "EX", ttlSec);
    await pipeline.exec();

    return lease;
  }

  async completeTask(leaseId: string): Promise<void> {
    const raw = await this.redis.get(this.leaseDataKey(leaseId));
    if (raw == null) {
      return;
    }
    const stored = JSON.parse(raw) as LeaseStored;
    const task = JSON.parse(stored.taskJson) as Task;

    const pipeline = this.redis.pipeline();
    pipeline.lrem(this.processingKey(task.targetQueue), 1, stored.taskJson);
    pipeline.del(this.leaseDataKey(leaseId), this.leaseByTaskKey(task.id));
    await pipeline.exec();
  }

  async requeueTask(taskId: string): Promise<void> {
    const leaseId = await this.redis.get(this.leaseByTaskKey(taskId));
    if (leaseId == null) {
      return;
    }
    const leaseRaw = await this.redis.get(this.leaseDataKey(leaseId));
    if (leaseRaw == null) {
      return;
    }
    const stored = JSON.parse(leaseRaw) as LeaseStored;
    const task = JSON.parse(stored.taskJson) as Task;

    const pipeline = this.redis.pipeline();
    pipeline.lrem(this.processingKey(task.targetQueue), 1, stored.taskJson);
    pipeline.rpush(this.queueKey(task.targetQueue), stored.taskJson);
    pipeline.del(this.leaseDataKey(leaseId), this.leaseByTaskKey(taskId));
    await pipeline.exec();
  }

  async recoverStaleProcessing(queueName: string, maxAgeMs: number): Promise<number> {
    const pkey = this.processingKey(queueName);
    const items = await this.redis.lrange(pkey, 0, -1);
    let recovered = 0;

    for (const taskJson of items) {
      const task = JSON.parse(taskJson) as Task;
      const leaseIdRef = await this.redis.get(this.leaseByTaskKey(task.id));

      let shouldRecover = false;
      if (!leaseIdRef) {
        shouldRecover = true;
      } else {
        const lr = await this.redis.get(this.leaseDataKey(leaseIdRef));
        if (!lr) {
          shouldRecover = true;
        } else {
          const stored = JSON.parse(lr) as LeaseStored;
          const age = Date.now() - new Date(stored.leasedAt).getTime();
          if (age > maxAgeMs) {
            shouldRecover = true;
          }
        }
      }

      if (shouldRecover) {
        await this.redis.lrem(pkey, 1, taskJson);
        await this.redis.rpush(this.queueKey(queueName), taskJson);
        if (leaseIdRef) {
          await this.redis.del(this.leaseDataKey(leaseIdRef), this.leaseByTaskKey(task.id));
        }
        recovered += 1;
      }
    }

    return recovered;
  }
}
