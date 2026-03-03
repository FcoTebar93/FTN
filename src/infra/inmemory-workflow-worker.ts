import type { WorkflowWorkerDeps } from "../workers/workflow-worker";
import type { TaskLease } from "../shared/tasks";

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

        await this.runtime.runWorkflowTick(task.workflowId, task.runId);
        await this.taskQueue.completeTask(lease.leaseId);
    }

    async runForever(cancellationSignal: { aborted: boolean }): Promise<void> {
        while (!cancellationSignal.aborted){
            await this.runOnce();
            await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
        }
    }
}