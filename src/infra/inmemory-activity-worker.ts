import { ActivityRegistry } from "../app/activities";
import { WorkflowEngine } from "../core/engine";
import { WorkflowEvent } from "../core/events";
import { WorkflowState } from "../core/workflow-state";
import { EventStore } from "../modules/event-store";
import { SnapshotStore } from "../modules/snapshot-store";
import { TaskQueue } from "../modules/task-queue";
import { Version } from "../shared/types";


interface InMemoryActivityWorkerDeps {
    taskQueue: TaskQueue;
    activities: ActivityRegistry;
    eventStore: EventStore;
    snapshotStore: SnapshotStore;
    engine: WorkflowEngine;
    activityQueueName: string;
}

export class InMemoryActivityWorker {
    constructor(private readonly deps: InMemoryActivityWorkerDeps) {}
  
    async runOnce(): Promise<void> {
      const lease = await this.deps.taskQueue.leaseNextTask(
        "activity-worker-1",
        this.deps.activityQueueName,
        10000
      );
      if (!lease) return;
  
      const { task } = lease;
      if (task.type !== "activity") {
        await this.deps.taskQueue.completeTask(lease.leaseId);
        return;
      }
  
      const { workflowId, runId, activityId, activityName } = task;

      const snapshot = await this.deps.snapshotStore.loadLatestSnapshot(workflowId, runId);

      const fromVersion: Version = snapshot?.version ?? 0;

      const events: WorkflowEvent[] = await this.deps.eventStore.loadEvents(workflowId, runId, fromVersion);

      if (!snapshot && events.length === 0) {
        await this.deps.taskQueue.completeTask(lease.leaseId);
        return;
      }

      const rehydrated = this.deps.engine.replay(workflowId, runId, events, snapshot?.state);

      const state: WorkflowState = rehydrated.state;
      const lastEventVersion: Version = rehydrated.lastEventVersion;

      const pending = state.pendingActivities.find((a) => a.id === activityId);
      if (!pending) {
        await this.deps.taskQueue.completeTask(lease.leaseId);
        return;
      }

      const fn = this.deps.activities.getActivity(activityName);
      if (!fn){
        await this.deps.taskQueue.completeTask(lease.leaseId);
        return;
      }

      const result = await fn(pending.input);

      const activityCompleted: Omit<WorkflowEvent, "id" | "version" | "startedAt"> = {
        type: "ActivityCompleted",
        workflowId,
        runId,
        payload: {
          activityId,
          result,
        },
      };

      const [persisted] = await this.deps.eventStore.appendEvents(workflowId, runId, lastEventVersion, [activityCompleted]) as WorkflowEvent[];

      this.deps.engine.applyEvent(state, persisted);

      await this.deps.taskQueue.completeTask(lease.leaseId);
    }
}