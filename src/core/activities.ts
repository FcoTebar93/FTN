export type ActivityName = string;
import type { JsonSchema } from "../shared/json-schema";

export interface ActivityExecutionContext {
  workflowId: string;
  runId: string;
  activityId: string;
  attempt: number;
  scheduledAt: Date;
  log: (message: string, meta?: Record<string, unknown>) => void;
  idempotencyKey?: string;
  /** Misma cadena que en tareas de cola / HTTP (X-Correlation-Id o X-Request-Id). */
  correlationId?: string;
}

export interface ActivityDefinition<TInput, TResult> {
  name: ActivityName;
  execute: (input: TInput, ctx: ActivityExecutionContext) => Promise<TResult> | TResult;
  maxAttempts?: number;
  timeoutMs?: number;
  tags?: string[];
  version?: string;

  inputSchema?: JsonSchema;
  resultSchema?: JsonSchema;
}

export type AnyActivityDefinition = ActivityDefinition<any, any>;