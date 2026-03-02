import type { Task, TaskLease } from "../shared/tasks";
import type { WorkerId } from "../shared/types";

export interface TaskQueue {
    enqueue(task: Task): Promise<void>;

    leaseNextTask(workerId: WorkerId, queueName: string, timeoutMs: number): Promise<TaskLease | null>;

    completeTask(leaseId: string): Promise<void>;

    requeueTask(taskId: string): Promise<void>;
}