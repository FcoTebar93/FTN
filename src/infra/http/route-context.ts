import type { ApiSecurityConfig } from "./security";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { InMemoryActivityRegistry } from "../../modules/activity-registry/inmemory-activity-registry";
import type { InMemoryWorkflowRuntime } from "../inmemory-workflow-runtime";
import type { EventStore } from "../../modules/event-store";
import type { TaskQueue } from "../../modules/task-queue";

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
    opts?: { correlationId?: string; tenantId?: string }
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
}
