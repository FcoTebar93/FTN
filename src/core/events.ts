import type { WorkflowId, RunId, ActivityId, WorkerId, EventId, Version, StepId } from "../shared/types";

export type WorkflowEventType =
    | "WorkflowStarted"
    | "WorkflowCompleted"
    | "WorkflowFailed"
    | "ActivityScheduled"
    | "ActivityCompleted"
    | "ActivityFailed"
    | "StepForked"
    | "StepJoined"
    | "SignalReceived"
    | "SnapshotCreated"
    | "TimerScheduled"
    | "ConditionalBranchChosen"
    | "RetryAttemptStarted"
    | "RetryGivenUp"
    | "ConditionalBranchChosen";

export interface BaseWorkflowEvent {
    id: EventId;
    workflowId: WorkflowId;
    runId: RunId;
    version: Version;
    type: WorkflowEventType;
    startedAt: string;
}

export interface WorkflowStartedEvent extends BaseWorkflowEvent {
    type: "WorkflowStarted";
    payload: {
        name: string;
        input: unknown;
    };
}

export interface ActivityScheduledEvent extends BaseWorkflowEvent {
    type: "ActivityScheduled";
    payload: {
        activityId: ActivityId;
        activityName: string;
        input: unknown;
    };
}

export interface ActivityCompletedEvent extends BaseWorkflowEvent {
    type: "ActivityCompleted";
    payload: {
        activityId: ActivityId;
        result: unknown;
    };
}

export interface ActivityFailedEvent extends BaseWorkflowEvent {
    type: "ActivityFailed";
    payload: {
        activityId: ActivityId;
        reason: string;
        details?: unknown;
    };
}

export interface StepForkedEvent extends BaseWorkflowEvent {
    type: "StepForked";
    payload: {
        forkId: string;
        parentId: string;
        
    };
}

export interface StepJoinedEvent extends BaseWorkflowEvent {
    type: "StepJoined";
    payload: {
        joinId: string;
        forkIds: string[];
    };
}

export interface SignalReceivedEvent extends BaseWorkflowEvent {
    type: "SignalReceived";
    payload: {
        signalName: string;
        data?: unknown;
    };
}

export interface WorkflowCompletedEvent extends BaseWorkflowEvent {
    type: "WorkflowCompleted";
    payload: {
        result?: unknown;
    };
}

export interface WorkflowFailedEvent extends BaseWorkflowEvent {
    type: "WorkflowFailed";
    payload: {
        reason: string;
        details?: unknown;
    };
}

export interface SnapshotCreatedEvent extends BaseWorkflowEvent {
    type: "SnapshotCreated";
    payload: {
        snapshotVersion: Version;
    };
}

export interface TimerScheduledEvent extends BaseWorkflowEvent {
    type: "TimerScheduled";
    payload: {
      wakeAt: string;
    };
}

export interface ConditionalBranchChosenEvent extends BaseWorkflowEvent {
    type: "ConditionalBranchChosen";
    payload: {
      stepId: StepId;
      branch: "then" | "else";
    };
}

export interface RetryAttemptStartedEvent extends BaseWorkflowEvent {
    type: "RetryAttemptStarted";
    payload: {
        stepId: StepId;
        attempt: number;
    };
}

export interface RetryGivenUpEvent extends BaseWorkflowEvent {
    type: "RetryGivenUp";
    payload: {
        stepId: StepId;
        attempts: number;
        reason: string;
    };
}

export interface ConditionalBranchChosen extends BaseWorkflowEvent {
    type: "ConditionalBranchChosen";
    payload: {
        stepId: StepId;
        branch: "then" | "else";
    };
}

export type WorkflowEvent =
    | WorkflowStartedEvent
    | ActivityScheduledEvent
    | ActivityCompletedEvent
    | ActivityFailedEvent
    | StepForkedEvent
    | StepJoinedEvent
    | SignalReceivedEvent
    | WorkflowCompletedEvent
    | WorkflowFailedEvent
    | SnapshotCreatedEvent
    | TimerScheduledEvent
    | ConditionalBranchChosenEvent
    | RetryAttemptStartedEvent
    | RetryGivenUpEvent;