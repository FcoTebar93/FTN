import type { WorkflowId, RunId, Version } from "../shared/types";
import type { WorkflowState } from "../core/workflow-state";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowEngine } from "../core/engine";
import type { WorkflowDefinition } from "../core/ftn";
import type { SnapshotStore } from "./snapshot-store";
import type { EventStore } from "./event-store";
import type { TaskQueue } from "./task-queue";

export interface WorkflowRuntimeConfig {
    snapshotInterval: number;
}

export interface WorkflowRuntimeDeps {
    engine: WorkflowEngine;
    eventStore: EventStore;
    snapshotStore: SnapshotStore;
    taskQueue: TaskQueue;
    config: WorkflowRuntimeConfig;
}

export interface StartWorkflowOptions<TInput, TResult> {
    workflowName: string;
    input: TInput;
    definition: WorkflowDefinition<TInput, TResult>;
}

export interface StartWorkflowResult {
    workflowId: WorkflowId;
    runId: RunId;
    version: Version;
}

export interface WorkflowTickResult {
    state: WorkflowState;
    newEvents: WorkflowEvent[];
    snapshotCreated: boolean;
}

export interface WorkflowRuntime {
    startWorkflow<TInput, TResult>(options: StartWorkflowOptions<TInput, TResult>): Promise<StartWorkflowResult>;

    runWorkflowTick(workflowId: WorkflowId, runId: RunId): Promise<WorkflowTickResult>;

    loadCurrentState(workflowId: WorkflowId, runId: RunId): Promise<WorkflowState | null>;
}