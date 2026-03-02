import type { WorkflowId, RunId, ActivityId, WorkerId } from "./types";

export type TaskType = "workflow" | "activity";

export interface BaseTask {
    id: string;
    type: TaskType;
    createdAt: string;
    scheduledAt: string;
    workerType: "workflow" | "activity";
    targetQueue: string;
}

export interface WorkflowTask extends BaseTask {
    type: "workflow";
    workflowId: WorkflowId;
    runId: RunId;
}

export interface ActivityTask extends BaseTask {
    type: "activity";
    workflowId: WorkflowId;
    runId: RunId;
    activityId: ActivityId;
    activityName: string;
}

export type Task = WorkflowTask | ActivityTask;

export interface TaskLease {
    task: Task;
    workerId: WorkerId;
    leaseId: string;
    leasedAt: string;
    leaseTimeoutMs: number;
}