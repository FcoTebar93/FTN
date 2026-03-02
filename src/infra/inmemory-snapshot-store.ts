import type { SnapshotStore, WorkflowSnapshot } from "../modules/snapshot-store";
import type { WorkflowId, RunId } from "../shared/types";

type SnapshotKey = string;

function makeSnapshotKey(workflowId: WorkflowId, runId: RunId): SnapshotKey {
    return `${workflowId}:${runId}`;
}

export class InMemorySnapshotStore implements SnapshotStore {
    private readonly snapshots = new Map<SnapshotKey, WorkflowSnapshot>();

    async loadLatestSnapshot(workflowId: WorkflowId, runId: RunId): Promise<WorkflowSnapshot | undefined> {
        const key = makeSnapshotKey(workflowId, runId);
        return this.snapshots.get(key);
    }

    async saveSnapshot(snapshot: WorkflowSnapshot): Promise<void> {
        const key = makeSnapshotKey(snapshot.workflowId, snapshot.runId);
        this.snapshots.set(key, snapshot);
    }
}