import type { WorkflowRuntime, WorkflowRuntimeDeps, StartWorkflowOptions, StartWorkflowResult, WorkflowTickResult } from "../modules/workflow-runtime";
import type { WorkflowId, RunId, Version, StepId, ConditionalStep } from "../shared/types";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowState } from "../core/workflow-state";
import type { FTNApi, ActivityHandle, WorkflowDefinition, RetryOptions } from "../core/ftn";
import type { ActivityId } from "../shared/types";
import type { ActivityTask } from "../shared/tasks";


type WorkflowKey = string;

type StoredDefinition = {
    name: string;
    definition: WorkflowDefinition<any, any>;
    input: unknown;
};

function generateWorkflowId(): WorkflowId {
    return `workflow-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function generateStepId(): StepId {
  return `step-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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

        const { workflowName, input } = options;

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

        const newDomainEvents: Omit<WorkflowEvent, "id" | "version" | "startedAt">[] = [];
        let definitionResult: unknown;

        const ftn: FTNApi = {
          activity<TInput, TResult>(
            name: string,
            input: TInput
          ): ActivityHandle<TResult> {
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

          conditional: async <TResult>(
            condition: () => boolean,
            thenBranch: () => Promise<TResult>,
            elseBranch?: () => Promise<TResult>
          ): Promise<TResult> => {
            const stepId = generateStepId();
          
            const existingStep = currentState.steps.find(
              (step) => step.id === stepId && step.kind === "conditional"
            );
          
            if (!existingStep) {
              const newConditionalStep: ConditionalStep = {
                id: stepId,
                kind: "conditional",
                status: "running",
                branchChosen: undefined,
              };
          
              currentState = {
                ...currentState,
                steps: [...currentState.steps, newConditionalStep],
              };
            }
          
            const allEvents: WorkflowEvent[] = await this.eventStore.loadEvents(
              workflowId,
              runId,
              0 as Version
            );
          
            const branchEvent = [...allEvents]
              .reverse()
              .find(
                (e) =>
                  e.type === "ConditionalBranchChosen" &&
                  e.payload.stepId === stepId
              );
          
            let branch: "then" | "else";
          
            if (branchEvent && branchEvent.type === "ConditionalBranchChosen") {
              branch = branchEvent.payload.branch;
            } else {
              const cond = condition();
              branch = cond ? "then" : "else";
          
              newDomainEvents.push({
                type: "ConditionalBranchChosen",
                workflowId,
                runId,
                payload: {
                  stepId,
                  branch,
                },
              });
            }
          
            if (branch === "then") {
              return thenBranch();
            } else {
              if (!elseBranch) {
                return undefined as unknown as TResult;
              }
              return elseBranch();
            }
          },

          retry: async <TResult>(
            options: RetryOptions,
            operation: () => Promise<TResult>
          ): Promise<TResult> => {
            const stepId = generateStepId();
            const maxAttempts = options.maxAttempts;
            const backOffMs = options.backOffMs ?? 0;
          
            const allEvents = await this.eventStore.loadEvents(workflowId, runId, 0 as Version);
            const attemptsSoFar = allEvents.filter(
              (e) =>
                e.type === "RetryAttemptStarted" &&
                e.payload.stepId === stepId
            ).length;
          
            if (attemptsSoFar >= maxAttempts) {
              throw new Error(
                `Retry exhausted for step ${stepId} (${attemptsSoFar} attempts)`
              );
            }
          
            newDomainEvents.push({
              type: "RetryAttemptStarted",
              workflowId,
              runId,
              payload: {
                stepId,
                attempt: attemptsSoFar + 1,
              },
            });
          
            try {
              return await operation();
            } catch (err) {
              if (attemptsSoFar + 1 >= maxAttempts) {
                newDomainEvents.push({
                  type: "RetryGivenUp",
                  workflowId,
                  runId,
                  payload: {
                    stepId,
                    attempts: attemptsSoFar + 1,
                    reason: (err as Error).message,
                  },
                });
          
                throw err;
              }
          
              if (backOffMs > 0) {
                const wakeAt = new Date(Date.now() + backOffMs).toISOString();
                newDomainEvents.push({
                  type: "TimerScheduled",
                  workflowId,
                  runId,
                  payload: { wakeAt },
                });
              }
          
              throw err;
            }
          },

          sleep: async (ms: number): Promise<void> => {
            const wakeAt = new Date(Date.now() + ms).toISOString();
            newDomainEvents.push({
              type: "TimerScheduled",
              workflowId,
              runId,
              payload: { wakeAt },
            });
          },

          signal: async <TData = unknown>(name: string): Promise<TData> => {
            const allEventsForSignal: WorkflowEvent[] =
              await this.eventStore.loadEvents(workflowId, runId, 0 as Version);
          
            const signalEvent = [...allEventsForSignal]
              .reverse()
              .find(
                (e) =>
                  e.type === "SignalReceived" && e.payload.signalName === name
              );
          
              if (!signalEvent || signalEvent.type !== "SignalReceived") {
                throw new Error(
                  `Signal "${name}" not found for workflow ${workflowId}/${runId}`
                );
              }
              
              return signalEvent.payload.data as TData;
          },
        };

        const key = makeWorkflowKey(workflowId, runId);
        const defEntry = this.definitions.get(key);

        const shouldExecuteDefinition = !!defEntry && events.length <= 1;

        if (shouldExecuteDefinition && defEntry) {
          try {
            definitionResult = await defEntry.definition(ftn, defEntry.input);
          } catch {
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

        for (const ev of appended) {
            currentState = this.engine.applyEvent(currentState, ev);

            if (ev.type === "ActivityScheduled") {
                const { activityId, activityName, input } = ev.payload;
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
                };
                activityTasks.push(task);
                }
            }

            for (const task of activityTasks) {
                await this.taskQueue.enqueue(task);
            }
        }

        if (currentState.status === "running" && currentState.pendingActivities.length === 0 && currentState.pendingTimers.length === 0) {
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
            snapshotCreated
          };
    }
}