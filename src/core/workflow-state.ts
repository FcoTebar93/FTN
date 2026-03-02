import type { WorkflowId, RunId, ActivityId, Version } from "../shared/types";

export type WorkflowStatus =
    | "running"
    | "completed"
    | "failed";

export interface PendingActivity {
    id: ActivityId;
    name: string;
    result: unknown;
}

export interface CompletedActivity {
    id: ActivityId;
    name: string;
    input: unknown;
    result: unknown;
}

export interface WorkflowState {
    id: WorkflowId;
    runId: RunId;
    status: WorkflowStatus;
    version: Version;
    startedAt?: string;
    completedAt?: string;
    failedAt?: string;
    failureReason?: string;

    pendingActivities: PendingActivity[];
    completedActivities: CompletedActivity[];

    stepState: unknown;
}


