export type WorkflowId = string;
export type RunId = string;
export type ActivityId = string;
export type WorkerId = string;
export type EventId = string;
export type Version = number;
export type StepId = string;

export type StepStatus = "idle" | "running" | "waiting" | "completed" | "failed";

export interface BaseStep {
    id: StepId;
    kind: "activity" | "sleep" | "parallel" | "conditional" | "retry";
    status: StepStatus;
}

export interface ActivityStep extends BaseStep {
    kind: "activity";
    activityId: ActivityId;
    activityName: string;
}

export interface SleepStep extends BaseStep {
    kind: "sleep";
    wakeAt: string;
}

export interface ConditionalStep extends BaseStep {
    kind: "conditional";
    branchChosen?: "then" | "else";
}

export interface RetryStep extends BaseStep {
    kind: "retry";
    attempts: number;
    maxAttempts: number;
}

export type CancellationSignal = {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void): void;
    removeEventListener(type: "abort", listener: () => void): void;
};

export interface Timestamped {
    timestamp: string;
}

export type StepRecord =
    | ActivityStep
    | SleepStep
    | ConditionalStep
    | RetryStep;