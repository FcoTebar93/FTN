import type { TaskQueue } from "../modules/task-queue";
import type { TaskLease, TimerTask } from "../shared/tasks";
import type { Logger } from "./logger";
import type { DeadLetterInput } from "../shared/dead-letter";
import { incTimerTaskDequeue } from "./metrics";
import { buildWorkflowTask } from "../shared/task-factories";

interface InMemoryTimerWorkerDeps {
    taskQueue: TaskQueue;
    queueName: string;
    workflowQueueName: string;
    pollIntervalMs: number;
    log: Logger;
    onDeadLetter?: (entry: DeadLetterInput) => void;
}

export class InMemoryTimerWorker {
    private readonly dispatchedTimerKeys = new Set<string>();

    constructor(private readonly deps: InMemoryTimerWorkerDeps) {}

    async runOnce(): Promise<void> {
        const lease: TaskLease | null = await this.deps.taskQueue.leaseNextTask(
            "timer-worker-1",
            this.deps.queueName,
            10_000
        );

        if (!lease) {
            return;
        }

        const { task } = lease;

        if (task.type !== "timer") {
            await this.deps.taskQueue.completeTask(lease.leaseId);
            return;
        }
        
        const timerTask = task as TimerTask;
        incTimerTaskDequeue();
        this.deps.log.debug("timer-worker.taskDequeued", {
            workflowId: timerTask.workflowId,
            runId: timerTask.runId,
            wakeAt: timerTask.wakeAt,
            timerKey: timerTask.timerKey,
            sourceEventVersion: timerTask.sourceEventVersion,
            correlationId: timerTask.correlationId,
        });
        const now = new Date();
        const wakeAt = new Date(timerTask.wakeAt);

        if (wakeAt > now) {
            await this.deps.taskQueue.completeTask(lease.leaseId);
            await this.deps.taskQueue.enqueue({
                ...timerTask,
                scheduledAt: timerTask.wakeAt,
            });
            return;
        }

        if (this.dispatchedTimerKeys.has(timerTask.timerKey)) {
            this.deps.log.debug("timer-worker.duplicateTimerIgnored", {
                workflowId: timerTask.workflowId,
                runId: timerTask.runId,
                timerKey: timerTask.timerKey,
                correlationId: timerTask.correlationId,
            });
            await this.deps.taskQueue.completeTask(lease.leaseId);
            return;
        }

        const wfTask = buildWorkflowTask({
            id: `wf-task-${timerTask.workflowId}-${timerTask.runId}-${timerTask.timerKey}`,
            workflowId: timerTask.workflowId,
            runId: timerTask.runId,
            targetQueue: this.deps.workflowQueueName,
            correlationId: timerTask.correlationId,
        });

        this.dispatchedTimerKeys.add(timerTask.timerKey);
        await this.deps.taskQueue.enqueue(wfTask);
        await this.deps.taskQueue.completeTask(lease.leaseId);
    }

    async runForever(cancellationSignal: { aborted: boolean }): Promise<void> {
        while (!cancellationSignal.aborted) {
            try {
                await this.runOnce();
            } catch (error) {
                this.deps.onDeadLetter?.({
                    queueName: this.deps.queueName,
                    taskId: "unknown",
                    taskType: "timer",
                    reason: "timer_worker_error",
                    error: String(error),
                });
                this.deps.log.error("timer-worker.runOnce", { err: String(error) });
            }
            await new Promise(resolve => setTimeout(resolve, this.deps.pollIntervalMs));
        }
    }
}