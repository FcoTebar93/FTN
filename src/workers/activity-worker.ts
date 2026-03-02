import type { WorkerId } from "../shared/types";
import type { TaskQueue } from "../modules/task-queue";
import type { ActivityRegistry } from "../app/activities";
import type { CancellationSignal } from "../shared/types";

export interface ActivityWorkerConfig {
    queueName: string;
    leaseTimeoutMs: number;
    pollIntervalMs: number;
}

export interface ActivityWorkerDeps {
    workerId: WorkerId;
    taskQueue: TaskQueue;
    activities: ActivityRegistry;
    config: ActivityWorkerConfig;
}

export interface ActivityWorker {
    runOnce(): Promise<void>;

    runForever(cancellationSignal: CancellationSignal): Promise<void>;
}