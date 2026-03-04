import type { WorkflowEngine, RehydratedWorkflow } from "./engine";
import type { WorkflowState } from "./workflow-state";
import type { WorkflowEvent } from "./events";
import type { WorkflowId, RunId, ActivityStep, SleepStep } from "../shared/types";

export class DefaultWorkflowEngine implements WorkflowEngine {
    initializeFromStartEvent(event: WorkflowEvent): WorkflowState {
        if (event.type !== "WorkflowStarted") {
            throw new Error(`Expected WorkflowStarted event, got ${event.type}`);
        }

        return {
            id: event.workflowId,
            runId: event.runId,
            status: "running",
            version: event.version,
            startedAt: event.startedAt,
            completedAt: undefined,
            failedAt: undefined,
            failureReason: undefined,
            pendingActivities: [],
            completedActivities: [],
            pendingTimers: [],
            steps: [],
            stepState: undefined
        };
    }

    applyEvent(state: WorkflowState, event: WorkflowEvent): WorkflowState {
        if (event.workflowId !== state.id || event.runId !== state.runId) {
            throw new Error(`Event ${event.id} is not applicable to workflow ${state.id} run ${state.runId}`);
        }

        let nextState: WorkflowState = { ...state, version: event.version };

        switch (event.type) {
            case "WorkflowStarted": {
                return nextState;
            }
            case "ActivityScheduled": {
                const { activityId, activityName, input } = event.payload;
              
                const activityStep: ActivityStep = {
                  id: activityId,           
                  kind: "activity",
                  status: "running",
                  activityId,
                  activityName,
                };
              
                return {
                  ...nextState,
                  pendingActivities: [
                    ...nextState.pendingActivities,
                    { id: activityId, name: activityName, input },
                  ],
                  steps: [...nextState.steps, activityStep],
                };
            }
            case "ActivityCompleted": {
                const { activityId, result } = event.payload;
              
                const pending = nextState.pendingActivities.filter(a => a.id !== activityId);
                const previous = nextState.pendingActivities.find(a => a.id === activityId);
              
                return {
                  ...nextState,
                  pendingActivities: pending,
                  completedActivities: previous
                    ? [
                        ...nextState.completedActivities,
                        {
                          id: activityId,
                          name: previous.name,
                          input: previous.input,
                          result,
                        },
                      ]
                    : nextState.completedActivities,
                  steps: nextState.steps.map(step =>
                    step.kind === "activity" && step.activityId === activityId
                      ? { ...step, status: "completed" }
                      : step
                  ),
                };
            }
            case "ActivityFailed": {
                const { reason } = event.payload;
                return {
                    ...nextState,
                    status: "failed",
                    failedAt: event.startedAt,
                    failureReason: reason,
                }
            }
            case "WorkflowCompleted": {
                return {
                    ...nextState,
                    status: "completed",
                    completedAt: event.startedAt,
                    result: event.payload.result,
                }
            }
            case "WorkflowFailed": {
                const { reason } = event.payload;
                return {
                    ...nextState,
                    status: "failed",
                    failedAt: event.startedAt,
                    failureReason: reason,
                }
            }
            case "SnapshotCreated": {
                const { snapshotVersion } = event.payload;
                return {
                    ...nextState,
                    version: snapshotVersion,
                }
            }
            case "TimerScheduled": {
                const { wakeAt } = event.payload;
              
                const sleepStep: SleepStep = {
                  id: `sleep-${event.version}`,
                  kind: "sleep",
                  status: "waiting",
                  wakeAt,
                };
              
                return {
                  ...nextState,
                  pendingTimers: [...nextState.pendingTimers, { wakeAt }],
                  steps: [...nextState.steps, sleepStep],
                };
            }
            case "ConditionalBranchChosen": {
                const { stepId, branch } = event.payload;

                return {
                    ...nextState,
                    steps: nextState.steps.map((step) =>
                    step.id === stepId && step.kind === "conditional"
                        ? { ...step, status: "completed", branchChosen: branch }
                        : step
                    ),
                };
            }
            case "RetryAttemptStarted": {
                const { stepId, attempt } = event.payload;
              
                return {
                  ...nextState,
                  steps: nextState.steps.map((step) =>
                    step.id === stepId && step.kind === "retry"
                      ? { ...step, attempts: attempt, status: "running" }
                      : step
                  ),
                };
              }
              case "RetryGivenUp": {
                const { stepId, attempts, reason } = event.payload;
              
                return {
                  ...nextState,
                  steps: nextState.steps.map((step) =>
                    step.id === stepId && step.kind === "retry"
                      ? { ...step, attempts, status: "failed" }
                      : step
                  ),
                };
            }
            case "RetryGivenUp": {
                const { stepId, attempts, reason } = event.payload;
              
                return {
                  ...nextState,
                  steps: nextState.steps.map((step) =>
                    step.id === stepId && step.kind === "retry"
                      ? { ...step, attempts, status: "failed" }
                      : step
                  ),
                };
            }
            case "SignalReceived":
            case "StepForked":
            case "StepJoined": {
                return nextState;
            }
            default: {
                const _exhaustive: never = event;
                return _exhaustive;
            }
        }
    }

    replay(workflowId: WorkflowId, runId: RunId, events: WorkflowEvent[], baseState?: WorkflowState): RehydratedWorkflow {
        if (!events.length) {
            if (!baseState) {
                throw new Error("No events and no base state provided");
            }
            return {
                state: baseState,
                lastEventVersion: baseState.version
            }
        }

        let state: WorkflowState;

        if (baseState) {
            state = baseState;
        } else {
            const startEvent = events.find((e) => e.type === "WorkflowStarted");
            
            if (!startEvent) {
                throw new Error("No start event found in events array");
            }

            state = this.initializeFromStartEvent(startEvent);
        }

        for (const event of events) {
            if (!baseState && event.type === "WorkflowStarted") {
                continue;
            }
            state = this.applyEvent(state, event);
        }

        const lastEvent = events[events.length - 1];

        return {
            state,
            lastEventVersion: lastEvent ? lastEvent.version : state.version
        }
    }
}
