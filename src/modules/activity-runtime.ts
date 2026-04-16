import type { ActivityTask, ActivityResult } from "../shared/activity-types";
import type { EventStore } from "./event-store";
import type { SnapshotStore } from "./snapshot-store";
import type { WorkflowEngine } from "../core/engine";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowState } from "../core/workflow-state";
import type { Version } from "../shared/types";
import type { Logger } from "../infra/logger";
import { addEventAppends, incActivityFailure, incSnapshotLoaded } from "../infra/metrics";

export interface ActivityRuntime {
  deserializeTask(raw: unknown): ActivityTask;
  handleResult(task: ActivityTask, result: ActivityResult): Promise<void>;
}

export interface ActivityRuntimeDeps {
  eventStore: EventStore;
  snapshotStore: SnapshotStore;
  engine: WorkflowEngine;
  log?: Logger;
}

export class DefaultActivityRuntime implements ActivityRuntime {
  constructor(private readonly deps: ActivityRuntimeDeps) {}

  deserializeTask(raw: unknown): ActivityTask {
    return raw as ActivityTask;
  }

  async handleResult(task: ActivityTask, result: ActivityResult): Promise<void> {
    const { workflowId, runId, activityId } = task;
    const { eventStore, snapshotStore, engine } = this.deps;

    const snapshot = await snapshotStore.loadLatestSnapshot(workflowId, runId);
    const fromVersion: Version = snapshot?.version ?? 0;

    if (snapshot) {
      incSnapshotLoaded();
      this.deps.log?.debug("activity-runtime.snapshotLoaded", {
        workflowId,
        runId,
        snapshotVersion: snapshot.version,
        activityId,
      });
    }

    const events: WorkflowEvent[] = await eventStore.loadEvents(
      workflowId,
      runId,
      fromVersion
    );

    if (!snapshot && events.length === 0) {
      return;
    }

    const rehydrated = engine.replay(
      workflowId,
      runId,
      events,
      snapshot?.state
    );

    const state: WorkflowState = rehydrated.state;
    const lastEventVersion: Version = rehydrated.lastEventVersion;

    const pending = state.pendingActivities.find((a) => a.id === activityId);
    if (!pending) {
      return;
    }

    const domainEvent: Omit<WorkflowEvent, "id" | "version" | "startedAt"> =
      result.kind === "success" ? {
            type: "ActivityCompleted",
            workflowId,
            runId,
            payload: {
              activityId,
              result: result.result,
            },
          } : {
            type: "ActivityFailed",
            workflowId,
            runId,
            payload: {
              activityId,
              reason: result.errorMessage,
              details: {
                errorType: result.errorType,
                retryable: result.retryable,
              },
            },
          };

    const [persisted] = (await eventStore.appendEvents(
      workflowId,
      runId,
      lastEventVersion,
      [domainEvent]
    )) as WorkflowEvent[];
    addEventAppends(1);

    if (result.kind === "failure") {
      incActivityFailure();
      this.deps.log?.warn("activity-runtime.activityFailed", {
        workflowId,
        runId,
        activityId,
        errorType: result.errorType,
        retryable: result.retryable,
      });
    } else {
      this.deps.log?.debug("activity-runtime.activityCompleted", {
        workflowId,
        runId,
        activityId,
      });
    }

    engine.applyEvent(state, persisted);
  }
}