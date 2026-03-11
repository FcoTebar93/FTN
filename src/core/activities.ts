export type ActivityName = string;

export interface ActivityExecutionContext {
  workflowId: string;
  runId: string;
  activityId: string;
  attempt: number;
  scheduledAt: Date;
  log: (message: string, meta?: Record<string, unknown>) => void;
  idempotencyKey?: string;
}
export interface ActivityDefinition<TInput, TResult> {
  name: ActivityName;
  execute: (input: TInput, ctx: ActivityExecutionContext) => Promise<TResult> | TResult;
  maxAttempts?: number;
  timeoutMs?: number;
  tags?: string[];
  version?: string;
}

export type AnyActivityDefinition = ActivityDefinition<any, any>;