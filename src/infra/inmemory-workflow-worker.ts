import type { WorkflowWorkerDeps } from "../workers/workflow-worker";
import type { TaskLease } from "../shared/tasks";
import { ConcurrencyError } from "../modules/event-store";
import { incActivityRetry, incConcurrencyConflict, incWorkflowTaskDequeue } from "./metrics";
import { buildWorkflowTask } from "../shared/task-factories";

const DEFAULT_CONCURRENCY_RETRY_MAX_ATTEMPTS = 8;
const DEFAULT_CONCURRENCY_RETRY_BASE_DELAY_MS = 25;
const DEFAULT_CONCURRENCY_RETRY_MAX_DELAY_MS = 1000;
const DEFAULT_CONCURRENCY_RETRY_JITTER_RATIO = 0.2;

export class InMemoryWorkflowWorker {
    private readonly workerId;
    private readonly taskQueue;
    private readonly runtime;
    private readonly config;
    private readonly log;
    private readonly onDeadLetter;

    constructor(deps: WorkflowWorkerDeps) {
        this.workerId = deps.workerId;
        this.taskQueue = deps.taskQueue;
        this.runtime = deps.runtime;
        this.config = deps.config;
        this.log = deps.log;
        this.onDeadLetter = deps.onDeadLetter;
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

        incWorkflowTaskDequeue();
        this.log.debug("workflow-worker.taskDequeued", {
            workflowId: task.workflowId,
            runId: task.runId,
            queueName: this.config.queueName,
            correlationId: task.correlationId,
            retryCount: task.retryCount ?? 0,
        });

        let tickResult;
        try {
            tickResult = await this.runtime.runWorkflowTick(task.workflowId, task.runId, {
                correlationId: task.correlationId,
            });
        } catch (error) {
            if (error instanceof ConcurrencyError) {
                incConcurrencyConflict();
                incActivityRetry();
                const maxAttempts = this.config.concurrencyRetryMaxAttempts ?? DEFAULT_CONCURRENCY_RETRY_MAX_ATTEMPTS;
                const attempt = (task.retryCount ?? 0) + 1;

                if (attempt > maxAttempts) {
                    this.log.error("workflow-worker.concurrencyRetryExhausted", {
                        workflowId: task.workflowId,
                        runId: task.runId,
                        attempt,
                        maxAttempts,
                        correlationId: task.correlationId,
                    });
                    this.onDeadLetter?.({
                        queueName: this.config.queueName,
                        taskId: task.id,
                        taskType: task.type,
                        workflowId: task.workflowId,
                        runId: task.runId,
                        reason: "concurrency_retry_exhausted",
                        error: `Concurrency retry exhausted after ${maxAttempts} attempts`,
                        correlationId: task.correlationId,
                        task,
                    });
                    await this.taskQueue.completeTask(lease.leaseId);
                    return;
                }

                const delayMs = this.getRetryDelayMs(attempt);
                this.log.warn("workflow-worker.concurrencyRetry", {
                    workflowId: task.workflowId,
                    runId: task.runId,
                    attempt,
                    maxAttempts,
                    delayMs,
                    correlationId: task.correlationId,
                    expectedVersion: error.expectedVersion,
                    actualVersion: error.actualVersion,
                    streamKey: error.streamKey,
                    source: error.context.source,
                    operation: error.context.operation,
                });

                await this.sleep(delayMs);
                const retryTask = buildWorkflowTask({
                    id: `wf-task-${task.workflowId}-${task.runId}-retry-${attempt}-${Date.now()}`,
                    workflowId: task.workflowId,
                    runId: task.runId,
                    targetQueue: task.targetQueue,
                    correlationId: task.correlationId,
                    retryCount: attempt,
                });
                await this.taskQueue.completeTask(lease.leaseId);
                await this.taskQueue.enqueue(retryTask);
                return;
            }
            this.log.error("workflow-worker.runWorkflowTick", {
                err: String(error),
                workflowId: task.workflowId,
                runId: task.runId,
                correlationId: task.correlationId,
            });
            this.onDeadLetter?.({
                queueName: this.config.queueName,
                taskId: task.id,
                taskType: task.type,
                workflowId: task.workflowId,
                runId: task.runId,
                reason: "run_workflow_tick_error",
                error: String(error),
                correlationId: task.correlationId,
                task,
            });
            await this.taskQueue.completeTask(lease.leaseId);
            return;
        }
        await this.taskQueue.completeTask(lease.leaseId);

        const { state } = tickResult;
        const hasPending = state.pendingActivities.length > 0 || state.pendingTimers.length > 0;
        if (hasPending && state.status === "running") {
            const nextTask = buildWorkflowTask({
                id: `wf-task-${task.workflowId}-${task.runId}-${Date.now()}`,
                workflowId: task.workflowId,
                runId: task.runId,
                targetQueue: this.config.queueName,
                correlationId: task.correlationId,
            });
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
            this.log.error("workflow-worker.runForever", { err: String(error) });
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}