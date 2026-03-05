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

      try {
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
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const details = error instanceof Error ? { name: error.name, stack: error.stack } : undefined;

        const activityFailed: Omit<WorkflowEvent, "id" | "version" | "startedAt"> = {
          type: "ActivityFailed",
          workflowId,
          runId,
          payload: {
            activityId,
            reason,
            details,
          },
        };

        const [persisted] = await this.deps.eventStore.appendEvents(workflowId, runId, lastEventVersion, [activityFailed]) as WorkflowEvent[];
        this.deps.engine.applyEvent(state, persisted);
      }

      await this.deps.taskQueue.completeTask(lease.leaseId);
    }

    async runForever(cancellationSignal: { aborted: boolean }): Promise<void> {
      while (!cancellationSignal.aborted) {
        try {
          await this.runOnce();
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.error("[activity-worker] runOnce error:", error);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
}