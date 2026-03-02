import type { WorkflowId, RunId, Version } from "../shared/types";
import type { WorkflowEvent } from "../core/events";

export class ConcurrencyError extends Error {
    readonly workflowId: WorkflowId;
    readonly runId: RunId;
    readonly expectedVersion: Version;
    readonly actualVersion: Version;

    constructor(params: {
        workflowId: WorkflowId;
        runId: RunId;
        expectedVersion: Version;
        actualVersion: Version;
    }) {
        super(`Concurrency error for workflow ${params.workflowId} run ${params.runId}: expected version ${params.expectedVersion}, actual version ${params.actualVersion}`);
        this.workflowId = params.workflowId;
        this.runId = params.runId;
        this.expectedVersion = params.expectedVersion;
        this.actualVersion = params.actualVersion;
    }
}

export interface EventStore {
    loadEvents(workflowId: WorkflowId, runId: RunId, fromVersion: Version): Promise<WorkflowEvent[]>;

    appendEvents(workflowId: WorkflowId, runId: RunId, expectedVersion: Version, newEvents: Omit<WorkflowEvent, "id" | "version" | "startedAt">[]): Promise<WorkflowEvent[]>;
}