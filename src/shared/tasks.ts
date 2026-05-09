import type { WorkflowId, RunId, ActivityId, WorkerId, Version } from "./types";
import type { ActivityTask as ActivityPayload } from "./activity-types";

export type TaskType = "workflow" | "activity" | "timer";

export interface BaseTask {
    id: string;
    type: TaskType;
    createdAt: string;
    scheduledAt: string;
    workerType: "workflow" | "activity";
    targetQueue: string;
    correlationId?: string;
}

export interface WorkflowTask extends BaseTask {
    type: "workflow";
    workflowId: WorkflowId;
    runId: RunId;
    retryCount?: number;
}

export interface ActivityTask extends BaseTask {
    type: "activity";
    workflowId: WorkflowId;
    runId: RunId;
    activityId: ActivityId;
    activityName: string;
    payload: ActivityPayload;
}

export interface TimerTask extends BaseTask {
    type: "timer";
    workflowId: WorkflowId;
    runId: RunId;
    wakeAt: string;
    timerKey: string;
    sourceEventVersion?: Version;
}

export type Task = WorkflowTask | ActivityTask | TimerTask;

export interface TaskLease {
    task: Task;
    workerId: WorkerId;
    leaseId: string;
    leasedAt: string;
    leaseTimeoutMs: number;
}