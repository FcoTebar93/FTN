import type { WorkflowRuntime, WorkflowRuntimeDeps, StartWorkflowOptions, StartWorkflowResult, WorkflowTickResult } from "../modules/workflow-runtime";
import type { WorkflowId, RunId, Version, StepId } from "../shared/types";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowState } from "../core/workflow-state";
import type { FTNApi, ActivityHandle, WorkflowDefinition, RetryOptions } from "../core/ftn";
import type { ActivityId } from "../shared/types";
import type { ActivityTask as ActivityPayload } from "../shared/activity-types";
import type { ActivityTask, Task, TimerTask } from "../shared/tasks";

type WorkflowKey = string;

type StoredDefinition = {
    name: string;
    definition: WorkflowDefinition<any, any>;
    input: unknown;
};

function generateWorkflowId(): WorkflowId {
    return `workflow-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function generateRunId(): RunId {
    return `run-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function makeWorkflowKey(workflowId: WorkflowId, runId: RunId): WorkflowKey {
    return `${workflowId}:${runId}`
}

function generateActivityId(): ActivityId {
    return `activity-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/** Thrown when the workflow must pause until a timer fires or external history arrives (replay-safe). */
export class WorkflowSuspendedError extends Error {
  constructor() {
    super("Workflow suspended until timer or external event");
    this.name = "WorkflowSuspendedError";
  }
}

export class InMemoryWorkflowRuntime implements WorkflowRuntime {
    private readonly engine;
    private readonly eventStore;
    private readonly snapshotStore;
    private readonly config;
    private readonly taskQueue;
    private readonly definitions = new Map<WorkflowKey, StoredDefinition>();

    constructor(deps: WorkflowRuntimeDeps) {
        this.engine = deps.engine;
        this.eventStore = deps.eventStore;
        this.snapshotStore = deps.snapshotStore;
        this.taskQueue = deps.taskQueue;
        this.config = deps.config;
    }
    
    async loadCurrentState(
        workflowId: WorkflowId,
        runId: RunId
      ): Promise<WorkflowState | null> {
        const snapshot = await this.snapshotStore.loadLatestSnapshot(workflowId, runId);
        const fromVersion: Version = snapshot?.version ?? 0;
      
        const events: WorkflowEvent[] = await this.eventStore.loadEvents(
          workflowId,
          runId,
          fromVersion
        );
      
        if (!snapshot && events.length === 0) {
          return null;
        }
      
        const rehydrated = this.engine.replay(
          workflowId,
          runId,
          events,
          snapshot?.state
        );
      
        return rehydrated.state;
    }

    async startWorkflow<TInput, TResult>(options: StartWorkflowOptions<TInput, TResult>): Promise<StartWorkflowResult> {
        const workflowId = generateWorkflowId();
        const runId = generateRunId();

        const { workflowName, workflowVersion, input } = options;

        const key = makeWorkflowKey(workflowId, runId);
        this.definitions.set(key, {
            name: workflowName,
            definition: options.definition as WorkflowDefinition<any, any>,
            input: options.input as unknown,
        });
        
        const startEvent: Omit<WorkflowEvent, "id" | "version" | "startedAt"> = {
            type: "WorkflowStarted",
            workflowId,
            runId,
            payload: {
                name: workflowName,
                workflowVersion,
                input,
            },
        };

        const persisted = await this.eventStore.appendEvents(workflowId, runId, 0 as Version, [startEvent]) as WorkflowEvent[];

        const last = persisted[persisted.length - 1];

        return {
            workflowId,
            runId,
            version: last.version,
        };
    }

    async runWorkflowTick(workflowId: WorkflowId, runId: RunId): Promise<WorkflowTickResult> {
      const snapshot = await this.snapshotStore.loadLatestSnapshot(workflowId, runId);
      const fromVersion: Version | undefined = snapshot?.version;
    
      const events: WorkflowEvent[] = await this.eventStore.loadEvents(
        workflowId,
        runId,
        fromVersion ?? 0
      );
    
      if (!snapshot && events.length === 0) {
        throw new Error(
          `No events or snapshot found for workflow ${workflowId}/${runId}`
        );
      }
    
      const rehydrated = this.engine.replay(
        workflowId,
        runId,
        events,
        snapshot?.state
      );
    
      let currentState = rehydrated.state;
      let lastEventVersion = rehydrated.lastEventVersion;

      const fullHistory = await this.eventStore.loadEvents(workflowId, runId, 0);
    
      const newDomainEvents: Omit<WorkflowEvent, "id" | "version" | "startedAt">[] = [];
      let definitionResult: unknown;

      let nextRetryOrdinal = 0;
      let nextConditionalOrdinal = 0;
      const signalOrdinalByName = new Map<string, number>();

      const hasRetryAttemptRecorded = (stepId: StepId, attempt: number): boolean => {
        const inFull = fullHistory.some((e) => {
          if (e.type !== "RetryAttemptStarted") return false;
          return e.payload.stepId === stepId && e.payload.attempt === attempt;
        });
        const inPending = newDomainEvents.some((raw) => {
          const e = raw as WorkflowEvent;
          if (e.type !== "RetryAttemptStarted") return false;
          return e.payload.stepId === stepId && e.payload.attempt === attempt;
        });
        return inFull || inPending;
      };
    
      const ftn: FTNApi = {
        activity<TInput, TResult>(name: string, input: TInput, attempt?: number): ActivityHandle<TResult> {
          if (attempt !== undefined) {
            const activityId = generateActivityId();
            newDomainEvents.push({
              type: "ActivityScheduled",
              workflowId,
              runId,
              payload: {
                activityId,
                activityName: name,
                input,
              },
            });
            return { id: activityId, name };
          }

          const existing = currentState.pendingActivities.find(
            (a) => a.name === name && JSON.stringify(a.input) === JSON.stringify(input)
          ) ??
            currentState.completedActivities.find(
              (a) => a.name === name && JSON.stringify(a.input) === JSON.stringify(input)
            );

          if (existing) {
            return { id: existing.id, name: existing.name };
          }

          const activityId = generateActivityId();
          newDomainEvents.push({
            type: "ActivityScheduled",
            workflowId,
            runId,
            payload: {
              activityId,
              activityName: name,
              input,
            },
          });
          return { id: activityId, name };
        },

        parallel<TResult>(
          branches: Array<() => ActivityHandle<TResult>>
        ): ActivityHandle<TResult>[] {
          const handles: ActivityHandle<TResult>[] = [];
          for (const branch of branches) {
            const handle = branch();
            handles.push(handle);
          }
          return handles;
        },

        async join<TResult>(handles: ActivityHandle<TResult>[]): Promise<TResult[]> {
          const results: TResult[] = [];

          for (const handle of handles) {
            const completed = currentState.completedActivities.find(
              (a) => a.id === handle.id
            );
            if (!completed) {
              throw new Error(
                `Activity ${handle.id} is not completed yet; join must be called after completion`
              );
            }
            results.push(completed.result as TResult);
          }

          return results;
        },
        conditional: async function <TResult>(
          condition: () => boolean,
          thenBranch: () => Promise<TResult>,
          elseBranch?: () => Promise<TResult>
        ): Promise<TResult> {
          const stepId: StepId = `conditional-${nextConditionalOrdinal++}`;
          const existing = fullHistory.find(
            (e) =>
              e.type === "ConditionalBranchChosen" &&
              e.payload.stepId === stepId
          ) as
            | Extract<WorkflowEvent, { type: "ConditionalBranchChosen" }>
            | undefined;

          let branch: "then" | "else";
          if (existing) {
            branch = existing.payload.branch;
          } else {
            branch = condition() ? "then" : "else";
            newDomainEvents.push({
              type: "ConditionalBranchChosen",
              workflowId,
              runId,
              payload: { stepId, branch },
            });
          }

          return branch === "then"
            ? await thenBranch()
            : elseBranch
              ? await elseBranch()
              : (undefined as TResult);
        },
        retry: async function <TResult>(options: RetryOptions, operation: (attempt: number) => Promise<TResult>): Promise<TResult> {
          const stepId: StepId = `retry-${nextRetryOrdinal++}`;

          const hasRetryCompletedRecorded = (sid: StepId): boolean => {
            const inFull = fullHistory.some((e) => e.type === "RetryCompleted" && e.payload.stepId === sid);
            const inPending = newDomainEvents.some((raw) => {
              const e = raw as WorkflowEvent;
              return e.type === "RetryCompleted" && e.payload.stepId === sid;
            });
            return inFull || inPending;
          };

          const hasRetryGivenUpRecorded = (sid: StepId): boolean => {
            const inFull = fullHistory.some((e) => e.type === "RetryGivenUp" && e.payload.stepId === sid);
            const inPending = newDomainEvents.some((raw) => {
              const e = raw as WorkflowEvent;
              return e.type === "RetryGivenUp" && e.payload.stepId === sid;
            });
            return inFull || inPending;
          };

          let lastErr: unknown;
          const max = options.maxAttempts;
          for (let attempt = 1; attempt <= max; attempt++) {
            if (!hasRetryAttemptRecorded(stepId, attempt)) {
              newDomainEvents.push({
                type: "RetryAttemptStarted",
                workflowId,
                runId,
                payload: { stepId, attempt },
              });
            }
            try {
              const result = await operation(attempt);
              if (!hasRetryCompletedRecorded(stepId)) {
                newDomainEvents.push({
                  type: "RetryCompleted",
                  workflowId,
                  runId,
                  payload: { stepId, attempts: attempt },
                });
              }
              return result;
            } catch (e) {
              lastErr = e;
              if (attempt === max) {
                const reason = e instanceof Error ? e.message : String(e);
                if (!hasRetryGivenUpRecorded(stepId)) {
                  newDomainEvents.push({
                    type: "RetryGivenUp",
                    workflowId,
                    runId,
                    payload: { stepId, attempts: max, reason },
                  });
                }
                throw e;
              }
              if (options.backOffMs && options.backOffMs > 0) {
                const wakeAt = new Date(Date.now() + options.backOffMs).toISOString();
                newDomainEvents.push({
                  type: "TimerScheduled",
                  workflowId,
                  runId,
                  payload: {
                    wakeAt,
                    retryBackoff: { stepId, afterAttempt: attempt },
                  },
                });
                throw new WorkflowSuspendedError();
              }
            }
          }
          throw lastErr;
        },
        sleep: async function (ms: number): Promise<void> {
          const wakeAt = new Date(Date.now() + ms).toISOString();
          newDomainEvents.push({
            type: "TimerScheduled",
            workflowId,
            runId,
            payload: { wakeAt },
          });
          throw new WorkflowSuspendedError();
        },
        signal: function <TData = unknown>(name: string): Promise<TData> {
          const ordinal = signalOrdinalByName.get(name) ?? 0;
          const matches = fullHistory.filter(
            (e): e is Extract<WorkflowEvent, { type: "SignalReceived" }> =>
              e.type === "SignalReceived" && e.payload.signalName === name
          );
          const ev = matches[ordinal];
          if (ev) {
            signalOrdinalByName.set(name, ordinal + 1);
            return Promise.resolve(ev.payload.data as TData);
          }
          newDomainEvents.push({
            type: "SignalWaitStarted",
            workflowId,
            runId,
            payload: { signalName: name, ordinal },
          });
          throw new WorkflowSuspendedError();
        },
        workflowId: function (): WorkflowId {
          return workflowId;
        },
        runId: function (): RunId {
          return runId;
        },
      };
    
      const key = makeWorkflowKey(workflowId, runId);
      const defEntry = this.definitions.get(key);
    
      const shouldExecuteDefinition = !!defEntry && currentState.status === "running";
    
      let suspended = false;
      if (shouldExecuteDefinition && defEntry) {
        try {
          definitionResult = await defEntry.definition(ftn, defEntry.input);
        } catch (e) {
          if (e instanceof WorkflowSuspendedError) {
            suspended = true;
          }
          definitionResult = undefined;
        }
      }
    
      let appended: WorkflowEvent[] = [];
    
      if (newDomainEvents.length > 0) {
        appended = await this.eventStore.appendEvents(
          workflowId,
          runId,
          lastEventVersion,
          newDomainEvents
        );
        lastEventVersion = appended[appended.length - 1].version;
        const activityTasks: ActivityTask[] = [];
        const timerTasks: TimerTask[] = [];

        for (const ev of appended) {
          currentState = this.engine.applyEvent(currentState, ev);

          if (ev.type === "ActivityScheduled") {
            const { activityId, activityName, input } = ev.payload;
            const payload: ActivityPayload = {
              id: activityId,
              workflowId: ev.workflowId,
              runId: ev.runId,
              activityId,
              activityName,
              input,
              attempt: 1,
              scheduledAt: ev.startedAt,
            };

            const task: ActivityTask = {
              id: `task-${ev.workflowId}-${ev.runId}-${activityId}`,
              type: "activity",
              workflowId: ev.workflowId,
              runId: ev.runId,
              activityId,
              activityName,
              createdAt: ev.startedAt,
              scheduledAt: ev.startedAt,
              workerType: "activity",
              targetQueue: "activities",
              payload,
            };
            activityTasks.push(task);
          }

          if (ev.type === "TimerScheduled") {
            const { wakeAt } = ev.payload;
            timerTasks.push({
              id: `timer-${ev.workflowId}-${ev.runId}-${ev.version}`,
              type: "timer",
              workflowId: ev.workflowId,
              runId: ev.runId,
              wakeAt,
              createdAt: ev.startedAt,
              scheduledAt: ev.startedAt,
              workerType: "workflow",
              targetQueue: "timers",
            });
          }
        }

        for (const task of activityTasks) {
          await this.taskQueue.enqueue(task as Task);
        }
        for (const task of timerTasks) {
          await this.taskQueue.enqueue(task as Task);
        }
      }
    
      if (
        !suspended &&
        currentState.status === "running" &&
        currentState.pendingActivities.length === 0 &&
        currentState.pendingTimers.length === 0 &&
        (currentState.pendingSignalWaits?.length ?? 0) === 0
      ) {
        const completedEvent: Omit<WorkflowEvent, "id" | "version" | "startedAt"> = {
          type: "WorkflowCompleted",
          workflowId,
          runId,
          payload: {
            result: definitionResult,
          },
        };
    
        const [persistedCompleted] = await this.eventStore.appendEvents(
          workflowId,
          runId,
          lastEventVersion,
          [completedEvent]
        );
    
        lastEventVersion = persistedCompleted.version;
        currentState = this.engine.applyEvent(currentState, persistedCompleted);
        appended = [...appended, persistedCompleted];
      }
    
      const snapshotBaseVersion = snapshot?.version ?? 0;
      const eventsSinceSnapshot = lastEventVersion - snapshotBaseVersion;
      let snapshotCreated = false;
    
      if (
        eventsSinceSnapshot >= this.config.snapshotInterval &&
        lastEventVersion > snapshotBaseVersion
      ) {
        await this.snapshotStore.saveSnapshot({
          workflowId,
          runId,
          version: lastEventVersion,
          state: currentState,
          createdAt: new Date().toISOString(),
        });
        snapshotCreated = true;
      }
    
      return {
        state: currentState,
        newEvents: appended,
        snapshotCreated,
      };
    }
}