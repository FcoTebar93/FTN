import type { WorkflowId, RunId, Version } from "../shared/types";
import type { WorkflowState } from "../core/workflow-state";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowEngine } from "../core/engine";
import type { WorkflowDefinition } from "../core/ftn";
import type { SnapshotStore } from "./snapshot-store";
import type { EventStore } from "./event-store";
import type { TaskQueue } from "./task-queue";
import type { Logger } from "../infra/logger";

export interface WorkflowRuntimeConfig {
    snapshotInterval: number;
}

export interface WorkflowRuntimeDeps {
    engine: WorkflowEngine;
    eventStore: EventStore;
    snapshotStore: SnapshotStore;
    taskQueue: TaskQueue;
    config: WorkflowRuntimeConfig;
    log?: Logger;
}

export interface StartWorkflowOptions<TInput, TResult> {
    workflowName: string;
    workflowVersion?: string;
    tenantId?: string;
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

    runWorkflowTick(
        workflowId: WorkflowId,
        runId: RunId,
        options?: { correlationId?: string }
    ): Promise<WorkflowTickResult>;

    loadCurrentState(workflowId: WorkflowId, runId: RunId): Promise<WorkflowState | null>;
}