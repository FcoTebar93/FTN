import type { TaskQueue } from "../modules/task-queue";
import type { ActivityTask } from "../shared/activity-types";
import type { ActivityWorker } from "../workers/activity-worker";

interface InMemoryActivityQueueWorkerDeps {
  taskQueue: TaskQueue;
  worker: ActivityWorker;
  queueName: string;
  workerId: string;
  leaseTimeoutMs: number;
  pollIntervalMs: number;
}

export class InMemoryActivityQueueWorker {
  constructor(private readonly deps: InMemoryActivityQueueWorkerDeps) {}

  async runOnce(): Promise<void> {
    const lease = await this.deps.taskQueue.leaseNextTask(
      this.deps.workerId,
      this.deps.queueName,
      this.deps.leaseTimeoutMs
    );
    if (!lease) return;

    const { task } = lease;
    if (task.type !== "activity") {
      await this.deps.taskQueue.completeTask(lease.leaseId);
      return;
    }

    await this.deps.worker.handleTask(task as unknown as ActivityTask);

    await this.deps.taskQueue.completeTask(lease.leaseId);
  }

  async runForever(cancellation: { aborted: boolean }): Promise<void> {
    while (!cancellation.aborted) {
      try {
        await this.runOnce();
      } catch (err) {
        console.error("[activity-queue-worker] runOnce error:", err);
      }
      await new Promise((r) => setTimeout(r, this.deps.pollIntervalMs));
    }
  }
}