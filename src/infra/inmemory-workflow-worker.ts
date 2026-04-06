import type { WorkflowWorkerDeps } from "../workers/workflow-worker";
import type { TaskLease, WorkflowTask } from "../shared/tasks";
import { ConcurrencyError } from "../modules/event-store";

const DEFAULT_CONCURRENCY_RETRY_MAX_ATTEMPTS = 8;
const DEFAULT_CONCURRENCY_RETRY_BASE_DELAY_MS = 25;
const DEFAULT_CONCURRENCY_RETRY_MAX_DELAY_MS = 1000;
const DEFAULT_CONCURRENCY_RETRY_JITTER_RATIO = 0.2;

export class InMemoryWorkflowWorker {
    private readonly workerId;
    private readonly taskQueue;
    private readonly runtime;
    private readonly config;

    constructor(deps: WorkflowWorkerDeps) {
        this.workerId = deps.workerId;
        this.taskQueue = deps.taskQueue;
        this.runtime = deps.runtime;
        this.config = deps.config;
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private getRetryDelayMs(attempt: number): number {
        const base = this.config.concurrencyRetryBaseDelayMs ?? DEFAULT_CONCURRENCY_RETRY_BASE_DELAY_MS;
        const max = this.config.concurrencyRetryMaxDelayMs ?? DEFAULT_CONCURRENCY_RETRY_MAX_DELAY_MS;
        const jitterRatio = this.config.concurrencyRetryJitterRatio ?? DEFAULT_CONCURRENCY_RETRY_JITTER_RATIO;

        const exp = base * Math.pow(2, Math.max(0, attempt - 1));
        const unclamped = Math.min(exp, max);
        const jitterWindow = Math.max(0, Math.floor(unclamped * Math.max(0, jitterRatio)));
        const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
        return unclamped + jitter;
    }

    async runOnce(): Promise<void> {
        const lease: TaskLease | null = await this.taskQueue.leaseNextTask(
            this.workerId,
            this.config.queueName,
            this.config.leaseTimeoutMs
        );

        if (!lease){
            return;
        }

        const { task } = lease;

        if (task.type !== "workflow"){
            await this.taskQueue.completeTask(lease.leaseId);
            return;
        }

        let tickResult;
        try {
            tickResult = await this.runtime.runWorkflowTick(task.workflowId, task.runId);
        } catch (error) {
            if (error instanceof ConcurrencyError) {
                const maxAttempts = this.config.concurrencyRetryMaxAttempts ?? DEFAULT_CONCURRENCY_RETRY_MAX_ATTEMPTS;
                const attempt = (task.retryCount ?? 0) + 1;

                if (attempt > maxAttempts) {
                    console.error("[workflow-worker] concurrent tick retry budget exhausted, dropping task", {
                        workflowId: task.workflowId,
                        runId: task.runId,
                        attempt,
                        maxAttempts,
                    });
                    await this.taskQueue.completeTask(lease.leaseId);
                    return;
                }

                const delayMs = this.getRetryDelayMs(attempt);
                console.warn("[workflow-worker] concurrent tick detected, scheduling retry", {
                    workflowId: task.workflowId,
                    runId: task.runId,
                    attempt,
                    maxAttempts,
                    delayMs,
                });

                await this.sleep(delayMs);
                const retryTask: WorkflowTask = {
                    ...task,
                    id: `wf-task-${task.workflowId}-${task.runId}-retry-${attempt}-${Date.now()}`,
                    retryCount: attempt,
                    createdAt: new Date().toISOString(),
                    scheduledAt: new Date().toISOString(),
                };
                await this.taskQueue.enqueue(retryTask);
            } else {
                console.error("[workflow-worker] runWorkflowTick error:", error);
            }
            await this.taskQueue.completeTask(lease.leaseId);
            return;
        }
        await this.taskQueue.completeTask(lease.leaseId);

        const { state } = tickResult;
        const hasPending = state.pendingActivities.length > 0 || state.pendingTimers.length > 0;
        if (hasPending && state.status === "running") {
            const nextTask: WorkflowTask = {
                id: `wf-task-${task.workflowId}-${task.runId}-${Date.now()}`,
                type: "workflow",
                workflowId: task.workflowId,
                runId: task.runId,
                createdAt: new Date().toISOString(),
                scheduledAt: new Date().toISOString(),
                workerType: "workflow",
                targetQueue: this.config.queueName,
            };
            await this.taskQueue.enqueue(nextTask);
        }
    }

    async runForever(cancellationSignal: { aborted: boolean }): Promise<void> {
        try {
            while (!cancellationSignal.aborted){
                await this.runOnce();
                await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
            }           
        } catch (error) {
            console.error("[workflow-worker] runForever error:", error);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}