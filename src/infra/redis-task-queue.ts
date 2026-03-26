import type Redis from "ioredis";
import type { TaskQueue } from "../modules/task-queue";
import type { Task, TaskLease } from "../shared/tasks";
import type { WorkerId } from "../shared/types";

export interface RedisTaskQueueOptions {
  keyPrefix?: string;
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
    const raw = await this.redis.lpop(this.queueKey(queueName));
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
    const payload = JSON.stringify({ task, workerId });

    const pipeline = this.redis.pipeline();
    pipeline.set(this.leaseDataKey(leaseId), payload, "EX", ttlSec);
    pipeline.set(this.leaseByTaskKey(task.id), leaseId, "EX", ttlSec);
    await pipeline.exec();

    return lease;
  }

  async completeTask(leaseId: string): Promise<void> {
    const raw = await this.redis.get(this.leaseDataKey(leaseId));
    if (raw == null) {
      return;
    }
    const { task } = JSON.parse(raw) as { task: Task };
    await this.redis.del(this.leaseDataKey(leaseId), this.leaseByTaskKey(task.id));
  }

  async requeueTask(taskId: string): Promise<void> {
    const leaseId = await this.redis.get(this.leaseByTaskKey(taskId));
    if (leaseId == null) {
      return;
    }
    const raw = await this.redis.get(this.leaseDataKey(leaseId));
    if (raw == null) {
      return;
    }
    const { task } = JSON.parse(raw) as { task: Task };
    const pipeline = this.redis.pipeline();
    pipeline.rpush(this.queueKey(task.targetQueue), JSON.stringify(task));
    pipeline.del(this.leaseDataKey(leaseId));
    pipeline.del(this.leaseByTaskKey(taskId));
    await pipeline.exec();
  }
}
