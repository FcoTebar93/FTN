import { JsonSchema } from "../shared/json-schema";

export type StepKind = "activity" | "sleep" | "signal" | "conditional" | "parallel" | "retry";

export interface BaseStep {
  id: string;
  name?: string;
  next?: string | null;
}

export interface ActivityStep extends BaseStep {
  kind: "activity";
  activityName: string;
  input: Record<string, unknown>;
}

export interface SleepStep extends BaseStep {
  kind: "sleep";
  milliseconds: number;
}

export interface SignalStep extends BaseStep {
  kind: "signal";
  signalName: string;
}

export interface ConditionalStep extends BaseStep {
  kind: "conditional";
  expression: string;
  thenNext?: string | null;
  elseNext?: string | null;
}

export interface ParallelStep extends BaseStep {
  kind: "parallel";
  branches: string[][];
}

export interface RetryStep extends BaseStep {
  kind: "retry";
  maxAttempts: number;
  backOffMs?: number;
  targetStepId: string;
}

export type WorkflowStep = ActivityStep | SleepStep | SignalStep | ConditionalStep | ParallelStep | RetryStep;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ExecutionSchedule =
  | { type: "instant" }
  | { type: "daily"; hour: number; minute: number; timezone?: string }
  | { type: "weekly"; weekdays: Weekday[]; hour: number; minute: number; timezone?: string };

export interface StoredWorkflow {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  tags?: string[];
  inputSchema?: JsonSchema;
  resultSchema?: JsonSchema;
  schedule?: ExecutionSchedule;
  scheduledInput?: unknown;
  steps: WorkflowStep[];
  entryStepId: string;
}