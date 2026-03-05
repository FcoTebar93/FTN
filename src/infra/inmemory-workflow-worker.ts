import type { WorkflowWorkerDeps } from "../workers/workflow-worker";
import type { TaskLease, WorkflowTask } from "../shared/tasks";

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
            console.error("[workflow-worker] runWorkflowTick error:", error);
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