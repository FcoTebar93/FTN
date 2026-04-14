import type { TaskType } from "./tasks";

export interface DeadLetterEntry {
  id: string;
  occurredAt: string;
  queueName: string;
  taskId: string;
  taskType: TaskType;
  workflowId?: string;
  runId?: string;
  reason: string;
  error: string;
  correlationId?: string;
}

export interface DeadLetterInput {
  queueName: string;
  taskId: string;
  taskType: TaskType;
  workflowId?: string;
  runId?: string;
  reason: string;
  error: string;
  correlationId?: string;
}
