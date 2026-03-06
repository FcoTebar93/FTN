export type WorkflowStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowSummary {
    workflowId: string;
    runId: string;
    name: string;
    status: WorkflowStatus;
    startedAt?: string;
    completedAt?: string | null;
    failedAt?: string | null;
    failureReason?: string | null;
}

export interface PendingActivity {
    id: string;
    name: string;
    input: unknown;
}

export interface CompletedActivity {
    id: string;
    name: string;
    input: unknown;
    result: unknown;
}

export interface PendingTimer {
    wakeAt: string;
}

export interface StepRecord {
    id: string;
    kind: "activity" | "sleep" | "parallel" | "conditional" | "retry";
    status: "idle" | "running" | "waiting" | "completed" | "failed";
    activityId?: string;
    activityName?: string;
    wakeAt?: string;
    branchChosen?: "then" | "else";
    attempts?: number;
    maxAttempts?: number;
}

export interface WorkflowState {
    id: string;
    runId: string;
    status: WorkflowStatus;
    version: number;
    startedAt?: string;
    completedAt?: string | null;
    failedAt?: string | null;
    failureReason?: string | null;

    pendingActivities: PendingActivity[];
    completedActivities: CompletedActivity[];
    pendingTimers: PendingTimer[];
    steps: StepRecord[];

    result?: unknown;
    stepState?: unknown;
}

export interface WorkflowEvent {
    id: string;
    workflowId: string;
    runId: string;
    version: number;
    type: string;
    startedAt: string;
    payload: unknown;
}