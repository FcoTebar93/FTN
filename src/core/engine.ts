import type { WorkflowState } from "./workflow-state";
import type { WorkflowEvent } from "./events";
import type { WorkflowId, RunId, Version } from "../shared/types";

export interface EngineConfig {
    snapshotInterval: number;
}

export interface RehydratedWorkflow {
    state: WorkflowState;
    lastEventVersion: Version;
}

export interface WorkflowEngine {
    initializeFromStartEvent(event: WorkflowEvent): WorkflowState;

    applyEvent(state: WorkflowState, event: WorkflowEvent): WorkflowState;

    replay(workflowId: WorkflowId, runId: RunId, events: WorkflowEvent[], baseState?: WorkflowState): RehydratedWorkflow;
}