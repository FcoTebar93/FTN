import http from "node:http";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { ActivityRegistry } from "../../core/activity-registry";
import type { ApiSecurityConfig } from "../http/security";
import { applyCorsHeaders, getClientIp } from "../http/security";
import { authenticatePrincipal, checkProtectedAccess } from "../http/auth";
import { handleCatalogRoutes, type WorkflowPublicDescriptor } from "../http/catalog";
import { handleAppRoutes } from "../http/app-routes";
import { getPathname } from "../http/url";
import { incHttpForbidden, incHttpRateLimited, incHttpRequest, incHttpUnauthorized, renderPrometheusText } from "../metrics";
import { isAccessTokenJtiRevoked } from "../users";
import { runWithHttpSpan } from "../telemetry";
import type { EventStore } from "../../modules/event-store";
import type { TaskQueue } from "../../modules/task-queue";
import type { InMemoryWorkflowRuntime } from "../inmemory-workflow-runtime";
import type { DeadLetterEntry, DeadLetterStatus } from "../../shared/dead-letter";
import type { Logger } from "../logger";

interface BootstrapHttpServerInput {
  pool: Pool | undefined;
  redis: Redis | undefined;
  apiSecurity: ApiSecurityConfig;
  hasDbLogin: boolean;
  refreshTtlSeconds: number;
  systemSubject: string;
  multiTenantEnabled: boolean;
  rateLimiter: (key: string) => boolean;
  activities: ActivityRegistry;
  runtime: InMemoryWorkflowRuntime;
  eventStore: EventStore;
  taskQueue: TaskQueue;
  enqueueWorkflowStart: (
    name: string,
    input: unknown,
    opts?: { correlationId?: string; tenantId?: string; workflowVersion?: string }
  ) => Promise<{ workflowId: string; runId: string; version: number }>;
  getIntegrationsStatusForSubject: (subject: string) => Promise<Array<{
    key: string;
    label: string;
    configured: boolean;
    source: "credentials" | "env" | "none";
    details?: string;
  }>>;
  getIdempotentWorkflowStart: (key: string) => {
    workflowId: string;
    runId: string;
    version: number;
    name: string;
    inputHash: string;
    tenantId?: string;
  } | undefined;
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
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  listWorkflowsPublic: () => WorkflowPublicDescriptor[];
  getWorkflowPublicDescriptor: (name: string) => WorkflowPublicDescriptor | undefined;
  log: Logger;
}

export function bootstrapHttpServer(input: BootstrapHttpServerInput): http.Server {
  const server = http.createServer(async (req, res) => {
    applyCorsHeaders(req, res, input.apiSecurity.corsOrigins);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const requestId =
      typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].trim()
        ? req.headers["x-request-id"].trim().slice(0, 128)
        : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const correlationId =
      typeof req.headers["x-correlation-id"] === "string" && req.headers["x-correlation-id"].trim()
        ? req.headers["x-correlation-id"].trim().slice(0, 128)
        : requestId;
    res.setHeader("X-Correlation-Id", correlationId);

    const rawPathEarly = getPathname(req.url);
    const methodEarly = req.method ?? "GET";

    if (methodEarly === "GET" && rawPathEarly === "/metrics") {
      incHttpRequest();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(renderPrometheusText());
      return;
    }

    incHttpRequest();

    const access = checkProtectedAccess(req, input.apiSecurity, methodEarly, rawPathEarly);
    if (access === "unauthorized") {
      incHttpUnauthorized();
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (access === "forbidden") {
      incHttpForbidden();
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Forbidden", detail: "Insufficient scope" }));
      return;
    }
    const principal = authenticatePrincipal(req, input.apiSecurity);
    if (principal?.kind === "jwt" && principal.jti) {
      if (await isAccessTokenJtiRevoked(input.pool, principal.jti)) {
        incHttpUnauthorized();
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Unauthorized", detail: "Token revoked" }));
        return;
      }
    }
    const requestSubject =
      principal?.subject ??
      (principal?.kind === "api_key" ? "api_key" : input.systemSubject);
    const tenantIdHeader =
      typeof req.headers["x-tenant-id"] === "string" && req.headers["x-tenant-id"].trim()
        ? req.headers["x-tenant-id"].trim().slice(0, 128)
        : undefined;
    if (input.multiTenantEnabled && !tenantIdHeader) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing X-Tenant-Id header" }));
      return;
    }
    const tenantId = tenantIdHeader;
    const scopedSubject = tenantId ? `${tenantId}:${requestSubject}` : requestSubject;

    if (!input.rateLimiter(getClientIp(req, input.apiSecurity.trustProxy))) {
      incHttpRateLimited();
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Too many requests" }));
      return;
    }

    if (await handleCatalogRoutes(req, res, input.activities, {
      workflows: {
        list: input.listWorkflowsPublic,
        getWorkflowDescriptor: input.getWorkflowPublicDescriptor,
      },
    })) {
      return;
    }

    try {
      await runWithHttpSpan(
        req,
        async () => {
          await handleAppRoutes(
            {
              pool: input.pool,
              apiSecurity: input.apiSecurity,
              hasDbLogin: input.hasDbLogin,
              refreshTtlSeconds: input.refreshTtlSeconds,
              requestSubject: scopedSubject,
              activities: input.activities,
              runtime: input.runtime,
              eventStore: input.eventStore,
              taskQueue: input.taskQueue,
              redis: input.redis,
              enqueueWorkflowStart: input.enqueueWorkflowStart,
              getIntegrationsStatusForSubject: input.getIntegrationsStatusForSubject,
              requestId,
              correlationId,
              tenantId,
              stripeSecretKey: input.stripeSecretKey,
              stripeWebhookSecret: input.stripeWebhookSecret,
              getIdempotentWorkflowStart: input.getIdempotentWorkflowStart,
              saveIdempotentWorkflowStart: input.saveIdempotentWorkflowStart,
              listDeadLetters: input.listDeadLetters,
              requeueDeadLetter: input.requeueDeadLetter,
              acknowledgeDeadLetter: input.acknowledgeDeadLetter,
            },
            req,
            res
          );
        },
        { correlationId, requestId }
      );
    } catch (err) {
      input.log.error("http.handler", { err: String(err), requestId, correlationId });
      res.statusCode = 500;
      res.end(`Internal error: ${(err as Error).message}`);
    }
  });

  return server;
}
