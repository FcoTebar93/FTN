import type { WorkflowEvent } from "../core/events";
import { getWorkflow, getWorkflowDescriptor } from "../app/workflows";
import { validateJson } from "../shared/json-schema-validate";
import type { WorkflowTask } from "../shared/tasks";
import type { EventStore } from "../modules/event-store";
import type { TaskQueue } from "../modules/task-queue";
import type { WorkflowRuntime } from "../modules/workflow-runtime";

interface CreateWorkflowStartServiceDeps {
  eventStore: EventStore;
  runtime: WorkflowRuntime;
  taskQueue: TaskQueue;
  tenantMaxConcurrentRuns: number;
}

export interface WorkflowStartOptions {
  correlationId?: string;
  tenantId?: string;
  workflowVersion?: string;
}

export interface WorkflowStartService {
  enqueueWorkflowStart(
    name: string,
    input: unknown,
    opts?: WorkflowStartOptions
  ): Promise<{ workflowId: string; runId: string; version: number }>;
  countRunningRunsForTenant(tenantId: string): Promise<number>;
}

export function createWorkflowStartService(
  deps: CreateWorkflowStartServiceDeps
): WorkflowStartService {
  async function countRunningRunsForTenant(tenantId: string): Promise<number> {
    const keys = await deps.eventStore.listRunKeys();
    let running = 0;
    for (const { workflowId, runId } of keys) {
      const state = await deps.runtime.loadCurrentState(workflowId, runId);
      if (!state || state.status !== "running") {
        continue;
      }
      const stream = await deps.eventStore.loadEvents(workflowId, runId, 0);
      const started = stream.find(
        (event): event is Extract<WorkflowEvent, { type: "WorkflowStarted" }> =>
          event.type === "WorkflowStarted"
      );
      if (started?.payload.tenantId === tenantId) {
        running += 1;
      }
    }
    return running;
  }

  async function enqueueWorkflowStart(
    name: string,
    input: unknown,
    opts?: WorkflowStartOptions
  ): Promise<{ workflowId: string; runId: string; version: number }> {
    const descriptor = getWorkflowDescriptor(name, opts?.workflowVersion);
    const wfDef = getWorkflow(name, descriptor?.version ?? opts?.workflowVersion);
    if (!wfDef) {
      throw new Error(
        `Workflow not found: ${name}${opts?.workflowVersion ? `@${opts.workflowVersion}` : ""}`
      );
    }
    if (descriptor?.inputSchema) {
      const result = validateJson(descriptor.inputSchema, input);
      if (!result.valid) {
        throw new Error(`Invalid input: ${JSON.stringify(result.errors)}`);
      }
    }

    if (opts?.tenantId) {
      const running = await countRunningRunsForTenant(opts.tenantId);
      if (running >= deps.tenantMaxConcurrentRuns) {
        throw new Error(
          `Tenant run quota exceeded (${running}/${deps.tenantMaxConcurrentRuns}) for tenant "${opts.tenantId}"`
        );
      }
    }

    const { workflowId, runId, version } = await deps.runtime.startWorkflow({
      workflowName: name,
      workflowVersion: descriptor?.version ?? opts?.workflowVersion,
      tenantId: opts?.tenantId,
      input,
      definition: wfDef,
    });

    const task: WorkflowTask = {
      id: `wf-task-${workflowId}-${runId}`,
      type: "workflow",
      workflowId,
      runId,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
      ...(opts?.correlationId ? { correlationId: opts.correlationId } : {}),
    };
    await deps.taskQueue.enqueue(task);
    return { workflowId, runId, version };
  }

  return {
    enqueueWorkflowStart,
    countRunningRunsForTenant,
  };
}
