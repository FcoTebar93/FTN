import type { WorkflowRuntime, WorkflowRuntimeDeps, StartWorkflowOptions, StartWorkflowResult, WorkflowTickResult } from "../modules/workflow-runtime";
import type { WorkflowId, RunId, Version } from "../shared/types";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowState } from "../core/workflow-state";
import type { FTNApi, ActivityHandle, WorkflowDefinition } from "../core/ftn";
import type { ActivityId } from "../shared/types";

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

export class InMemoryWorkflowRuntime implements WorkflowRuntime {
    private readonly engine;
    private readonly eventStore;
    private readonly snapshotStore;
    private readonly config;
    private readonly definitions = new Map<WorkflowKey, StoredDefinition>();

    constructor(deps: WorkflowRuntimeDeps) {
        this.engine = deps.engine;
        this.eventStore = deps.eventStore;
        this.snapshotStore = deps.snapshotStore;
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

          parallel: async () => {
            throw new Error("Not implemented");
          },

          join: async () => {
            throw new Error("Not implemented");
          },

          conditional: async () => {
            throw new Error("Not implemented");
          },

          retry: async () => {
            throw new Error("Not implemented");
          },

          sleep: async () => {
            throw new Error("Not implemented");
          },

          signal: async () => {
            throw new Error("Not implemented");
          }
        };

        const key = makeWorkflowKey(workflowId, runId);
        const defEntry = this.definitions.get(key);

        const shouldExecuteDefinition = !!defEntry && events.length <= 1;
        
        if (shouldExecuteDefinition && defEntry) {
            await defEntry.definition(ftn, defEntry.input);
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

        for (const ev of appended) {
            currentState = this.engine.applyEvent(currentState, ev);
        }
        }

        return {
            state: currentState,
            newEvents: appended,
            snapshotCreated: false
          };
    }
}