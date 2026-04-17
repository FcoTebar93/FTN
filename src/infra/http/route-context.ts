import type { ApiSecurityConfig } from "./security";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { InMemoryActivityRegistry } from "../../modules/activity-registry/inmemory-activity-registry";
import type { InMemoryWorkflowRuntime } from "../inmemory-workflow-runtime";
import type { EventStore } from "../../modules/event-store";
import type { TaskQueue } from "../../modules/task-queue";
import type { DeadLetterEntry, DeadLetterStatus } from "../../shared/dead-letter";

export interface FtnAppRouteContext {
  pool: Pool | undefined;
  apiSecurity: ApiSecurityConfig;
  hasDbLogin: boolean;
  refreshTtlSeconds: number;
  requestSubject: string;
  activities: InMemoryActivityRegistry;
  runtime: InMemoryWorkflowRuntime;
  eventStore: EventStore;
  taskQueue: TaskQueue;
  redis: Redis | undefined;
  enqueueWorkflowStart: (
    name: string,
    input: unknown,
    opts?: { correlationId?: string; tenantId?: string; workflowVersion?: string }
  ) => Promise<{ workflowId: string; runId: string; version: number }>;
  getIntegrationsStatusForSubject: (subject: string) => Promise<
    Array<{
      key: string;
      label: string;
      configured: boolean;
      source: "credentials" | "env" | "none";
      details?: string;
    }>
  >;
  requestId: string;
  correlationId: string;
  tenantId?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  getIdempotentWorkflowStart: (
    key: string
  ) =>
    | {
        workflowId: string;
        runId: string;
        version: number;
        name: string;
        inputHash: string;
        tenantId?: string;
      }
    | undefined;
  saveIdempotentWorkflowStart: (
    key: string,
    value: {
      workflowId: string;
      runId: string;
      version: number;
      name: string;
      inputHash: string;
      tenantId?: string;
    }
  ) => void;
  listDeadLetters: (query?: {
    limit?: number;
    queueName?: string;
    taskType?: string;
    status?: DeadLetterStatus;
  }) => DeadLetterEntry[];
  requeueDeadLetter: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  acknowledgeDeadLetter: (id: string) => { ok: true } | { ok: false; error: string };
}
