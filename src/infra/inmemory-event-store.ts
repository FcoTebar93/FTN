import type { EventStore } from "../modules/event-store";
import { ConcurrencyError as ConcurrencyErrorImpl } from "../modules/event-store";
import { WorkflowEvent } from "../core/events";
import { WorkflowId, RunId, Version } from "../shared/types";

type StreamKey = string;

function makeStreamKey(workflowId: WorkflowId, runId: RunId): StreamKey {
    return `${workflowId}:${runId}`;
}

export class InMemoryEventStore implements EventStore {
    private readonly streams = new Map<StreamKey, WorkflowEvent[]>();

    async loadEvents(workflowId: WorkflowId, runId: RunId, fromVersion?: Version): Promise<WorkflowEvent[]> {
        const key = makeStreamKey(workflowId, runId);
        const events = this.streams.get(key) ?? [];
        
        if (fromVersion == null) {
            return [...events];
        }

        return events.filter((event) => event.version > fromVersion);
    }

    async appendEvents(workflowId: WorkflowId, runId: RunId, expectedVersion: Version, newEvents: Omit<WorkflowEvent, "id" | "version" | "startedAt">[]): Promise<WorkflowEvent[]> {
        const key = makeStreamKey(workflowId, runId);
        const existing = this.streams.get(key) ?? [];

        const currentVersion: Version = existing.length ? existing[existing.length - 1].version : 0;

        if (currentVersion !== expectedVersion) {
            throw new ConcurrencyErrorImpl({
                workflowId,
                runId,
                expectedVersion,
                actualVersion: currentVersion
            });
        }

        const now = new Date().toISOString();

        const appended = newEvents.map((event, index) => ({
            ...event,
            id: `${key}:${currentVersion + index + 1}`,
            version: currentVersion + index + 1,
            startedAt: now,
        })) as WorkflowEvent[];

        const updated = [...existing, ...appended];
        this.streams.set(key, updated);

        return appended;
    }
}