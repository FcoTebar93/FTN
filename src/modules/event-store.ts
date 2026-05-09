import type { WorkflowId, RunId, Version } from "../shared/types";
import type { WorkflowEvent } from "../core/events";

export interface ConcurrencyErrorContext {
    source?: string;
    operation?: string;
    correlationId?: string;
    attempt?: number;
}

export class ConcurrencyError extends Error {
    readonly workflowId: WorkflowId;
    readonly runId: RunId;
    readonly streamKey: string;
    readonly expectedVersion: Version;
    readonly actualVersion: Version;
    readonly context: ConcurrencyErrorContext;

    constructor(params: {
        workflowId: WorkflowId;
        runId: RunId;
        expectedVersion: Version;
        actualVersion: Version;
        context?: ConcurrencyErrorContext;
    }) {
        const streamKey = `${params.workflowId}:${params.runId}`;
        const source = params.context?.source ?? "unknown-source";
        super(
            `Concurrency error on ${source} for stream ${streamKey}: expected version ${params.expectedVersion}, actual version ${params.actualVersion}`
        );
        this.name = "ConcurrencyError";
        this.workflowId = params.workflowId;
        this.runId = params.runId;
        this.streamKey = streamKey;
        this.expectedVersion = params.expectedVersion;
        this.actualVersion = params.actualVersion;
        this.context = params.context ?? {};
    }
}

export interface EventStore {
    loadEvents(workflowId: WorkflowId, runId: RunId, fromVersion: Version): Promise<WorkflowEvent[]>;

    appendEvents(workflowId: WorkflowId, runId: RunId, expectedVersion: Version, newEvents: Omit<WorkflowEvent, "id" | "version" | "startedAt">[]): Promise<WorkflowEvent[]>;

    listRunKeys(): Promise<Array<{ workflowId: WorkflowId; runId: RunId }>>;
}