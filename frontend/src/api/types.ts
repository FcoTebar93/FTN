export type WorkflowStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowSummary {
    workflowId: string;
    runId: string;
    name: string;
    status: WorkflowStatus;
    startedAt?: string;
    completedAt?: string | null;
    failedAt?: string | null;
    failureReason?: string | null;
}

export interface PendingActivity {
    attempt: null;
    id: string;
    name: string;
    input: unknown;
}

export interface CompletedActivity {
    attempt: null;
    id: string;
    name: string;
    input: unknown;
    result: unknown;
}

export interface PendingTimer {
    wakeAt: string;
}

export interface StepRecord {
    id: string;
    kind: "activity" | "sleep" | "parallel" | "conditional" | "retry";
    status: "idle" | "running" | "waiting" | "completed" | "failed";
    activityId?: string;
    activityName?: string;
    wakeAt?: string;
    branchChosen?: "then" | "else";
    attempts?: number;
    maxAttempts?: number;
}

export interface WorkflowState {
    id: string;
    runId: string;
    status: WorkflowStatus;
    version: number;
    startedAt?: string;
    completedAt?: string | null;
    failedAt?: string | null;
    failureReason?: string | null;

    pendingActivities: PendingActivity[];
    completedActivities: CompletedActivity[];
    pendingTimers: PendingTimer[];
    pendingSignalWaits?: Array<{ signalName: string; ordinal: number }>;
    steps: StepRecord[];

    result?: unknown;
    stepState?: unknown;
}

export interface WorkflowEvent {
    id: string;
    workflowId: string;
    runId: string;
    version: number;
    type: string;
    startedAt: string;
    payload: unknown;
}

export type DesignerStepKind = "activity" | "sleep" | "signal" | "conditional" | "parallel";

export interface DesignerBaseStep {
  id: string;
  name?: string;
  next?: string | null;
}

interface DesignerActivityStep extends DesignerBaseStep {
  kind: "activity";
  activityName: string;
  input: Record<string, unknown>;
  integrationModule?: string;
}

export interface DesignerSleepStep extends DesignerBaseStep {
  kind: "sleep";
  milliseconds: number;
}

export interface DesignerSignalStep extends DesignerBaseStep {
  kind: "signal";
  signalName: string;
}

export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

export type DesignerWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DesignerExecutionSchedule =
  | { type: "instant" }
  | { type: "daily"; hour: number; minute: number; timezone?: string }
  | { type: "weekly"; weekdays: DesignerWeekday[]; hour: number; minute: number; timezone?: string };

export interface DesignerWorkflowSummary {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  tags?: string[];
  schedule?: DesignerExecutionSchedule;
  lastScheduledRunAt?: string;
  lastScheduledError?: string;
}

export interface DesignerStoredWorkflow extends DesignerWorkflowSummary {
  inputSchema?: JsonSchema;
  resultSchema?: JsonSchema;
  scheduledInput?: unknown;
  steps: DesignerWorkflowStep[];
  entryStepId: string;
}

export interface DesignerKindField {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "json" | "activity-select";
  required?: boolean;
  description?: string;
  min?: number;
  max?: number;
}

export interface DesignerKind {
  id: string;
  label: string;
  description?: string;
  fields: DesignerKindField[];
}

export interface ActivityCatalogItem {
  name: string;
  module: string;
  version?: string;
  tags: string[];
  timeoutMs: number | null;
  maxAttempts: number | null;
  inputSchema?: JsonSchema;
  resultSchema?: JsonSchema;
}

export interface CatalogWorkflow {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  tags: string[];
  examples?: Array<{ input: unknown; note?: string }>;
  inputSchema?: JsonSchema;
  resultSchema?: JsonSchema;
}

export interface CredentialSummary {
  provider: string;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  updatedAt: string;
}

export interface CredentialDetail extends CredentialSummary {
  secrets: Record<string, unknown>;
}

export interface IntegrationStatusItem {
  key: string;
  label: string;
  configured: boolean;
  source: "credentials" | "env" | "none";
  details?: string;
}

export interface DesignerConditionalStep extends DesignerBaseStep {
  kind: "conditional";
  expression: string;
  thenNext?: string | null;
  elseNext?: string | null;
  path?: string;
  operator?: string;
  right?: string;
}

export interface DesignerParallelStep extends DesignerBaseStep {
  kind: "parallel";
  branches: string[][];
}

export type DesignerWorkflowStep =
  | DesignerActivityStep
  | DesignerSleepStep
  | DesignerSignalStep
  | DesignerConditionalStep
  | DesignerParallelStep;