import type { WorkerId } from "../shared/types";
import type { WorkflowRuntime } from "../modules/workflow-runtime";
import type { TaskQueue } from "../modules/task-queue";
import type { CancellationSignal } from "../shared/types";

export interface WorkflowWorkerConfig {
    queueName: string;
    leaseTimeoutMs: number;
    pollIntervalMs: number;
}

export interface WorkflowWorkerDeps {
    workerId: WorkerId;
    taskQueue: TaskQueue;
    runtime: WorkflowRuntime;
    config: WorkflowWorkerConfig;
}

export interface WorkflowWorker {
    runOnce(): Promise<void>;

    runForever(cancellationSignal: CancellationSignal): Promise<void>;
}