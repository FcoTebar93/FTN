import type { WorkflowRuntime, WorkflowRuntimeDeps, StartWorkflowOptions, StartWorkflowResult, WorkflowTickResult } from "../modules/workflow-runtime";
import type { WorkflowId, RunId, Version } from "../shared/types";
import type { WorkflowEvent } from "../core/events";
import type { WorkflowState } from "../core/workflow-state";

function generateWorkflowId(): WorkflowId {
    return `workflow-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function generateRunId(): RunId {
    return `run-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

export class InMemoryWorkflowRuntime implements WorkflowRuntime {
    private readonly engine;
    private readonly eventStore;
    private readonly snapshotStore;
    private readonly config;

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
        
        return {
            state: rehydrated.state,
            newEvents: [],
            snapshotCreated: false,
        };
    }
}