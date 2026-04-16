import type { TaskQueue } from "../modules/task-queue";
import type { ActivityTask as ActivityPayload } from "../shared/activity-types";
import type { ActivityTask } from "../shared/tasks";
import type { ActivityWorker } from "../workers/activity-worker";
import type { Logger } from "./logger";
import type { DeadLetterInput } from "../shared/dead-letter";
import { incActivityTaskDequeue } from "./metrics";

interface InMemoryActivityQueueWorkerDeps {
  taskQueue: TaskQueue;
  worker: ActivityWorker;
  queueName: string;
  workerId: string;
  leaseTimeoutMs: number;
  pollIntervalMs: number;
  log: Logger;
  onDeadLetter?: (entry: DeadLetterInput) => void;
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

    const activityTask = task as ActivityTask;
    const payload: ActivityPayload = activityTask.payload;
    incActivityTaskDequeue();
    this.deps.log.debug("activity-queue-worker.taskDequeued", {
      workflowId: task.workflowId,
      runId: task.runId,
      activityId: activityTask.activityId,
      activityName: activityTask.activityName,
      correlationId: task.correlationId,
    });

    try {
      await this.deps.worker.handleTask(payload);
      await this.deps.taskQueue.completeTask(lease.leaseId);
    } catch (err) {
      this.deps.onDeadLetter?.({
        queueName: this.deps.queueName,
        taskId: task.id,
        taskType: task.type,
        workflowId: task.workflowId,
        runId: task.runId,
        reason: "activity_worker_error",
        error: String(err),
        correlationId: task.correlationId,
        task,
      });
      await this.deps.taskQueue.completeTask(lease.leaseId);
      throw err;
    }
  }

  async runForever(cancellation: { aborted: boolean }): Promise<void> {
    while (!cancellation.aborted) {
      try {
        await this.runOnce();
      } catch (err) {
        this.deps.log.error("activity-queue-worker.runOnce", { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, this.deps.pollIntervalMs));
    }
  }
}