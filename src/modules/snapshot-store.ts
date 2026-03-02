import type { WorkflowId,RunId, Version } from "../shared/types";
import type { WorkflowState } from "../core/workflow-state";

export interface WorkflowSnapshot {
    workflowId: WorkflowId;
    runId: RunId;
    version: Version;
    state: WorkflowState;
    createdAt: string;
}

export interface SnapshotStore {

    loadLatestSnapshot(workflowId: WorkflowId, runId: RunId): Promise<WorkflowSnapshot | undefined>;

    saveSnapshot(snapshot: WorkflowSnapshot): Promise<void>;
}