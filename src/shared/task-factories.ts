import type { TimerTask, WorkflowTask } from "./tasks";

interface BuildWorkflowTaskInput {
  id: string;
  workflowId: string;
  runId: string;
  targetQueue: string;
  correlationId?: string;
  retryCount?: number;
  createdAt?: string;
  scheduledAt?: string;
}

interface BuildTimerTaskInput {
  id: string;
  workflowId: string;
  runId: string;
  wakeAt: string;
  timerKey: string;
  sourceEventVersion?: number;
  targetQueue: string;
  correlationId?: string;
  createdAt?: string;
  scheduledAt?: string;
}

export function buildWorkflowTask(input: BuildWorkflowTaskInput): WorkflowTask {
  const now = new Date().toISOString();
  return {
    id: input.id,
    type: "workflow",
    workflowId: input.workflowId,
    runId: input.runId,
    createdAt: input.createdAt ?? now,
    scheduledAt: input.scheduledAt ?? now,
    workerType: "workflow",
    targetQueue: input.targetQueue,
    ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

export function buildTimerTask(input: BuildTimerTaskInput): TimerTask {
  const now = new Date().toISOString();
  return {
    id: input.id,
    type: "timer",
    workflowId: input.workflowId,
    runId: input.runId,
    wakeAt: input.wakeAt,
    timerKey: input.timerKey,
    ...(input.sourceEventVersion !== undefined ? { sourceEventVersion: input.sourceEventVersion } : {}),
    createdAt: input.createdAt ?? now,
    scheduledAt: input.scheduledAt ?? now,
    workerType: "workflow",
    targetQueue: input.targetQueue,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}
