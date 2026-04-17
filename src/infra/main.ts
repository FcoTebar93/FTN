import http from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Redis from "ioredis";

import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "./inmemory-event-store";
import { InMemorySnapshotStore } from "./inmemory-snapshot-store";
import { InMemoryTaskQueue } from "./inmemory-task-queue";
import { RedisTaskQueue } from "./redis-task-queue";
import type { TaskQueue } from "../modules/task-queue";
import { InMemoryWorkflowRuntime } from "./inmemory-workflow-runtime";

import { InMemoryWorkflowWorker } from "./inmemory-workflow-worker";
import { InMemoryTimerWorker } from "./inmemory-timer-worker";

import type { DeadLetterEntry, DeadLetterInput, DeadLetterStatus } from "../shared/dead-letter";
import { getWorkflow, getWorkflowDescriptor, listWorkflows } from "../app/workflows";

import { InMemoryActivityRegistry } from "../modules/activity-registry/inmemory-activity-registry";
import { registerIntegrations } from "../modules/integrations";
import type { IntegrationsConfig } from "../modules/integrations";
import { DefaultActivityRuntime } from "../modules/activity-runtime";
import { ActivityWorker } from "../workers/activity-worker";
import { InMemoryActivityQueueWorker } from "./inmemory-activity-queue-worker";
import { handleCatalogRoutes } from "./http/catalog";
import { handleAppRoutes } from "./http/app-routes";
import { applyCorsHeaders, createRateLimiter, loadApiSecurityConfigFromEnv, getClientIp } from "./http/security";
import { authenticatePrincipal, checkProtectedAccess } from "./http/auth";
import { getUserPasswordHash, insertUser, isAccessTokenJtiRevoked } from "./users";
import { normalizeAndValidateUsername, validatePlainPassword } from "./http/registration";
import { hashPassword } from "./passwords";
import { incHttpForbidden, incHttpRateLimited, incHttpRequest, incHttpUnauthorized, renderPrometheusText } from "./metrics";

import { configureDesignerStore, loadAllFromDatabase, listSchedulerRows, recordScheduledFailure, recordScheduledRun } from "../app/designer-store";
import { runScheduledWorkflowTick } from "../app/designer-scheduler";
import { configureCredentialsStore, getCredential } from "../app/credentials";
import { runPostgresMigrations } from "./postgres-migrations";
import { PostgresEventStore } from "./postgres-event-store";
import { PostgresSnapshotStore } from "./postgres-snapshot-store";
import { createLogger, type Logger } from "./logger";
import { buildIntegrationsStatusForSubject } from "./integrations-status";
import { initFtnTelemetry, runWithHttpSpan } from "./telemetry";
import { createWorkflowStartService } from "./workflow-start-service";
import { getPathname } from "./http/url";

function logProductionEnvWarnings(log: Logger, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const hasJwt = Boolean(env.FTN_JWT_SECRET?.trim());
  const hasApiKey = Boolean(env.FTN_API_KEY?.trim());
  if (!hasJwt && !hasApiKey) {
    log.warn("ftn.env.productionNoAuth", {
      message:
        "NODE_ENV=production sin FTN_JWT_SECRET ni FTN_API_KEY: la API queda sin autenticación HTTP.",
    });
  }

  const hasEngineDb = Boolean((env.FTN_ENGINE_DATABASE_URL ?? env.DATABASE_URL)?.trim());
  if (!hasEngineDb) {
    log.warn("ftn.env.productionMemoryPersistence", {
      message: "NODE_ENV=production sin DATABASE_URL/FTN_ENGINE_DATABASE_URL: motor en memoria (no persistente).",
    });
  }
}

async function main(): Promise<void> {
  const log = createLogger();
  initFtnTelemetry();
  const engine = new DefaultWorkflowEngine();

  const engineDsUrl = (process.env.FTN_ENGINE_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
  let pool: Pool | undefined;
  if (engineDsUrl) {
    pool = new Pool({ connectionString: engineDsUrl });
    await runPostgresMigrations(pool);
    log.info("ftn.engine.persistence", { backend: "postgres" });
  } else {
    log.info("ftn.engine.persistence", { backend: "memory" });
  }

  configureDesignerStore(pool);
  configureCredentialsStore(pool);

  const eventStore = pool ? new PostgresEventStore(pool) : new InMemoryEventStore();
  const snapshotStore = pool ? new PostgresSnapshotStore(pool) : new InMemorySnapshotStore();

  let redis: Redis | undefined;
  const redisUrl = process.env.REDIS_URL?.trim();
  let taskQueue: TaskQueue;
  let redisTaskQueue: RedisTaskQueue | undefined;
  if (redisUrl) {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
    const keyPrefix = process.env.FTN_REDIS_KEY_PREFIX?.trim();
    redisTaskQueue = new RedisTaskQueue(redis, keyPrefix ? { keyPrefix } : {});
    taskQueue = redisTaskQueue;
    log.info("ftn.taskQueue", { backend: "redis" });
  } else {
    taskQueue = new InMemoryTaskQueue();
    log.info("ftn.taskQueue", { backend: "memory" });
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const systemSubject = process.env.FTN_SYSTEM_SUBJECT?.trim() || "system";
  const stripeCredential = await getCredential(systemSubject, "stripe");
  const twilioCredential = await getCredential(systemSubject, "twilio");
  const kycCredential = await getCredential(systemSubject, "kyc");
  const notificationsCredential = await getCredential(systemSubject, "notifications");
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  const stripeSecretKey =
    str(stripeCredential?.secrets?.stripeSecretKey) ??
    str(stripeCredential?.secrets?.secretKey) ??
    str(stripeCredential?.config?.stripeSecretKey) ??
    str(process.env.STRIPE_SECRET_KEY);

  const sendgridApiKey =
    str(notificationsCredential?.secrets?.sendgridApiKey) ??
    str(notificationsCredential?.secrets?.apiKey) ??
    str(notificationsCredential?.config?.sendgridApiKey) ??
    str(process.env.SENDGRID_API_KEY);
  const emailFrom =
    str(notificationsCredential?.config?.emailFrom) ??
    str(notificationsCredential?.config?.from) ??
    str(process.env.EMAIL_FROM ?? process.env.SMTP_FROM);
  const slackWebhookUrl =
    str(notificationsCredential?.secrets?.slackWebhookUrl) ??
    str(notificationsCredential?.config?.slackWebhookUrl) ??
    str(process.env.SLACK_WEBHOOK_URL);

  const twilioAccountSid =
    str(twilioCredential?.secrets?.accountSid) ??
    str(twilioCredential?.secrets?.twilioAccountSid) ??
    str(twilioCredential?.config?.accountSid) ??
    str(process.env.TWILIO_ACCOUNT_SID);
  const twilioAuthToken =
    str(twilioCredential?.secrets?.authToken) ??
    str(twilioCredential?.secrets?.twilioAuthToken) ??
    str(twilioCredential?.config?.authToken) ??
    str(process.env.TWILIO_AUTH_TOKEN);
  const twilioFromNumber =
    str(twilioCredential?.config?.fromNumber) ??
    str(twilioCredential?.config?.twilioFromNumber) ??
    str(process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER);

  const kycProviderUrl =
    str(kycCredential?.secrets?.providerUrl) ??
    str(kycCredential?.config?.providerUrl) ??
    str(process.env.KYC_PROVIDER_URL);
  const kycProviderToken =
    str(kycCredential?.secrets?.providerToken) ??
    str(kycCredential?.secrets?.token) ??
    str(kycCredential?.config?.providerToken) ??
    str(process.env.KYC_PROVIDER_TOKEN);

  const integrationsConfig: IntegrationsConfig = {
    storage: {
      enabled: !!databaseUrl,
      databaseUrl,
      ...(pool ? { pool } : {}),
    },
    documents: {
      enabled: true,
    },
    notifications: {
      enabled: true,
      sendgridApiKey,
      emailFrom,
      slackWebhookUrl,
      twilioAccountSid,
      twilioAuthToken,
      twilioFromNumber,
    },
    payments: {
      enabled: process.env.FTN_PAYMENTS_DISABLED !== "1" && process.env.FTN_PAYMENTS_DISABLED !== "true",
      stripeSecretKey,
    },
    identity: {
      enabled: true,
      providerUrl: kycProviderUrl,
      providerToken: kycProviderToken,
    },
    logistics: {
      enabled: true,
    },
    crm: {
      enabled: !!databaseUrl,
      databaseUrl,
      ...(pool ? { pool } : {}),
    },
    http: {
      enabled: process.env.FTN_HTTP_DISABLED !== "1" && process.env.FTN_HTTP_DISABLED !== "true",
      allowPrivateUrls: process.env.FTN_HTTP_ALLOW_PRIVATE_URLS === "1",
      maxResponseBodyBytes: 2_000_000,
    },
    messaging: {
      enabled: !!redisUrl,
      ...(redis ? { redis } : {}),
    },
  };

  const activities = new InMemoryActivityRegistry();
  registerIntegrations(activities, integrationsConfig);

  await loadAllFromDatabase();

  const activityRuntime = new DefaultActivityRuntime({ eventStore, snapshotStore, engine });
  const activityWorkerCore = new ActivityWorker(activities, activityRuntime);
  const deadLetterMaxItems = Math.max(
    100,
    Number.parseInt(process.env.FTN_DEAD_LETTER_MAX_ITEMS ?? "1000", 10) || 1000
  );
  const deadLetters: DeadLetterEntry[] = [];
  const addDeadLetter = (input: DeadLetterInput): void => {
    const entry: DeadLetterEntry = {
      id: `dlq-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      occurredAt: new Date().toISOString(),
      ...input,
    };
    deadLetters.unshift(entry);
    if (deadLetters.length > deadLetterMaxItems) {
      deadLetters.length = deadLetterMaxItems;
    }
  };
  const listDeadLetterStatus = (item: DeadLetterEntry): DeadLetterStatus => {
    if (item.acknowledgedAt) return "acknowledged";
    if (item.requeuedAt) return "requeued";
    return "pending";
  };
  const listDeadLetters = (query?: {
    limit?: number;
    queueName?: string;
    taskType?: string;
    status?: DeadLetterStatus;
  }): DeadLetterEntry[] => {
    const limit = Math.max(1, Math.min(500, query?.limit ?? 100));
    return deadLetters
      .filter((d) => (query?.queueName ? d.queueName === query.queueName : true))
      .filter((d) => (query?.taskType ? d.taskType === query.taskType : true))
      .filter((d) => (query?.status ? listDeadLetterStatus(d) === query.status : true))
      .slice(0, limit);
  };
  const requeueDeadLetter = async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const item = deadLetters.find((d) => d.id === id);
    if (!item) {
      return { ok: false, error: "Dead letter not found" };
    }
    if (item.requeuedAt) {
      return { ok: false, error: "Dead letter already requeued" };
    }
    if (!item.task) {
      return { ok: false, error: "Dead letter has no task payload to requeue" };
    }
    await taskQueue.enqueue(item.task);
    item.requeuedAt = new Date().toISOString();
    return { ok: true };
  };
  const acknowledgeDeadLetter = (id: string): { ok: true } | { ok: false; error: string } => {
    const item = deadLetters.find((d) => d.id === id);
    if (!item) {
      return { ok: false, error: "Dead letter not found" };
    }
    if (item.acknowledgedAt) {
      return { ok: false, error: "Dead letter already acknowledged" };
    }
    item.acknowledgedAt = new Date().toISOString();
    return { ok: true };
  };

  const activityQueueWorker = new InMemoryActivityQueueWorker({
    taskQueue,
    worker: activityWorkerCore,
    queueName: "activities",
    workerId: "activity-worker-1",
    leaseTimeoutMs: 10_000,
    pollIntervalMs: 100,
    log,
    onDeadLetter: addDeadLetter,
  });

  const runtime = new InMemoryWorkflowRuntime({
    engine,
    eventStore,
    snapshotStore,
    taskQueue,
    config: { snapshotInterval: 50 },
  });

  const workflowWorker = new InMemoryWorkflowWorker({
    workerId: "workflow-worker-1",
    taskQueue,
    runtime,
    log,
    onDeadLetter: addDeadLetter,
    config: {
      queueName: "workflows",
      leaseTimeoutMs: 10_000,
      pollIntervalMs: 100,
      concurrencyRetryMaxAttempts: Math.max(1, Number.parseInt(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_MAX_ATTEMPTS ?? "8", 10) || 8),
      concurrencyRetryBaseDelayMs: Math.max(0, Number.parseInt(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_BASE_DELAY_MS ?? "25", 10) || 25),
      concurrencyRetryMaxDelayMs: Math.max(1, Number.parseInt(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_MAX_DELAY_MS ?? "1000", 10) || 1000),
      concurrencyRetryJitterRatio: Math.max(0, Number.parseFloat(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_JITTER_RATIO ?? "0.2") || 0.2),
    },
  });

  const timerWorker = new InMemoryTimerWorker({
    taskQueue,
    queueName: "timers",
    workflowQueueName: "workflows",
    pollIntervalMs: 500,
    log,
    onDeadLetter: addDeadLetter,
  });

  const multiTenantEnabled =
    process.env.FTN_MULTI_TENANT_ENABLED === "1" || process.env.FTN_MULTI_TENANT_ENABLED === "true";
  const tenantMaxConcurrentRuns = Math.max(
    1,
    Number.parseInt(process.env.FTN_TENANT_MAX_CONCURRENT_RUNS ?? "100", 10) || 100
  );
  const idempotencyTtlMs = Math.max(
    60_000,
    Number.parseInt(process.env.FTN_IDEMPOTENCY_TTL_MS ?? String(24 * 60 * 60 * 1000), 10) || 24 * 60 * 60 * 1000
  );
  const idempotencyStore = new Map<
    string,
    {
      workflowId: string;
      runId: string;
      version: number;
      name: string;
      inputHash: string;
      tenantId?: string;
      createdAtMs: number;
    }
  >();
  const getIdempotentWorkflowStart = (key: string) => {
    const hit = idempotencyStore.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.createdAtMs > idempotencyTtlMs) {
      idempotencyStore.delete(key);
      return undefined;
    }
    const { createdAtMs: _createdAtMs, ...value } = hit;
    return value;
  };
  const saveIdempotentWorkflowStart = (
    key: string,
    value: {
      workflowId: string;
      runId: string;
      version: number;
      name: string;
      inputHash: string;
      tenantId?: string;
    }
  ) => {
    idempotencyStore.set(key, { ...value, createdAtMs: Date.now() });
  };
  const { enqueueWorkflowStart } = createWorkflowStartService({
    eventStore,
    runtime,
    taskQueue,
    tenantMaxConcurrentRuns,
  });

  const cancellation = { aborted: false };

  workflowWorker.runForever(cancellation).catch((err) => log.error("workflowWorker.runForever", { err: String(err) }));
  timerWorker.runForever(cancellation).catch((err) => log.error("timerWorker.runForever", { err: String(err) }));
  activityQueueWorker.runForever(cancellation).catch((err) => log.error("activityQueueWorker.runForever", { err: String(err) }));

  const apiSecurity = loadApiSecurityConfigFromEnv();
  logProductionEnvWarnings(log);
  const hasDbLogin = Boolean(pool && apiSecurity.jwtSecret);
  const rateLimiter = createRateLimiter(apiSecurity.rateLimitPerMinute);
  const refreshTtlSeconds = Math.max(60, parseInt(process.env.FTN_REFRESH_TTL_SECONDS ?? "604800", 10) || 604800);

  async function getIntegrationsStatusForSubject(subject: string): Promise<Array<{
    key: string;
    label: string;
    configured: boolean;
    source: "credentials" | "env" | "none";
    details?: string;
  }>> {
    return buildIntegrationsStatusForSubject(subject, {
      hasPostgres: Boolean(pool),
      hasRedis: Boolean(redis),
      getCredential,
      env: process.env,
    });
  }

  if (pool && apiSecurity.jwtSecret) {
    const defaultUsernameRaw = process.env.FTN_DEFAULT_USER_USERNAME?.trim() || "demo";
    const defaultPasswordRaw = process.env.FTN_DEFAULT_USER_PASSWORD?.trim() || "demo-password-123";
    const defaultUsername = normalizeAndValidateUsername(defaultUsernameRaw);
    if (defaultUsername && validatePlainPassword(defaultPasswordRaw)) {
      const exists = await getUserPasswordHash(pool, defaultUsername);
      if (!exists) {
        const hash = await hashPassword(defaultPasswordRaw);
        const inserted = await insertUser(pool, defaultUsername, hash);
        if (inserted === "ok") {
          log.info("ftn.auth.defaultUser.created", { username: defaultUsername });
        }
      }
    } else {
      log.error("ftn.auth.defaultUser.invalidConfig", {
        username: defaultUsernameRaw,
        passwordMinLength: 10,
      });
    }
  }

  const server = http.createServer(async (req, res) => {
    applyCorsHeaders(req, res, apiSecurity.corsOrigins);

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

    const access = checkProtectedAccess(req, apiSecurity, methodEarly, rawPathEarly);
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
    const principal = authenticatePrincipal(req, apiSecurity);
    if (principal?.kind === "jwt" && principal.jti) {
      if (await isAccessTokenJtiRevoked(pool, principal.jti)) {
        incHttpUnauthorized();
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Unauthorized", detail: "Token revoked" }));
        return;
      }
    }
    const requestSubject =
      principal?.subject ??
      (principal?.kind === "api_key" ? "api_key" : systemSubject);
    const tenantIdHeader =
      typeof req.headers["x-tenant-id"] === "string" && req.headers["x-tenant-id"].trim()
        ? req.headers["x-tenant-id"].trim().slice(0, 128)
        : undefined;
    if (multiTenantEnabled && !tenantIdHeader) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing X-Tenant-Id header" }));
      return;
    }
    const tenantId = tenantIdHeader;
    const scopedSubject = tenantId ? `${tenantId}:${requestSubject}` : requestSubject;

    if (!rateLimiter(getClientIp(req, apiSecurity.trustProxy))) {
      incHttpRateLimited();
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Too many requests" }));
      return;
    }

    if (await handleCatalogRoutes(req, res, activities, {
      workflows: {
        list: () =>
          listWorkflows().map((w) => ({
            name: w.name,
            version: w.version,
            displayName: w.displayName,
            description: w.description,
            tags: w.tags ?? [],
            examples: w.examples ?? [],
            inputSchema: w.inputSchema,
            resultSchema: w.resultSchema,
          })),
        getWorkflowDescriptor: (name: string) => {
          const w = getWorkflowDescriptor(name);
          if (!w) {
            return undefined;
          }
          return {
            name: w.name,
            version: w.version,
            displayName: w.displayName,
            description: w.description,
            tags: w.tags ?? [],
            examples: w.examples ?? [],
            inputSchema: w.inputSchema,
            resultSchema: w.resultSchema,
          };
        },
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
              pool,
              apiSecurity,
              hasDbLogin,
              refreshTtlSeconds,
              requestSubject: scopedSubject,
              activities,
              runtime,
              eventStore,
              taskQueue,
              redis,
              enqueueWorkflowStart,
              getIntegrationsStatusForSubject,
              requestId,
              correlationId,
              tenantId,
              getIdempotentWorkflowStart,
              saveIdempotentWorkflowStart,
              listDeadLetters,
              requeueDeadLetter,
              acknowledgeDeadLetter,
            },
            req,
            res
          );
        },
        { correlationId, requestId }
      );
    } catch (err) {
      log.error("http.handler", { err: String(err), requestId, correlationId });
      res.statusCode = 500;
      res.end(`Internal error: ${(err as Error).message}`);
    }
  });

  const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
  server.listen(PORT, () => {
    log.info("server.listen", { port: PORT, url: `http://localhost:${PORT}` });
  });

  let recoverTimer: ReturnType<typeof setInterval> | undefined;
  const recoverIntervalMs = Number(process.env.FTN_REDIS_RECOVER_INTERVAL_MS ?? "60000");
  const staleLeaseMs = Number(process.env.FTN_REDIS_STALE_LEASE_MS ?? String(10 * 60 * 1000));
  if (redisTaskQueue && recoverIntervalMs > 0) {
    const queues = ["workflows", "activities", "timers"] as const;
    recoverTimer = setInterval(() => {
      if (cancellation.aborted) {
        return;
      }
      void (async () => {
        for (const q of queues) {
          try {
            const n = await redisTaskQueue.recoverStaleProcessing(q, staleLeaseMs);
            if (n > 0) {
              log.info("ftn.taskQueue.recovered", { queue: q, count: n });
            }
          } catch (e) {
            log.error("ftn.taskQueue.recoverFailed", { queue: q, err: String(e) });
          }
        }
      })();
    }, recoverIntervalMs);
  }

  const designerSchedulerTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (cancellation.aborted) {
      return;
    }
    void runScheduledWorkflowTick({
      listSchedulerRows,
      recordScheduledRun,
      recordScheduledFailure,
      startWorkflow: async (name, input, opts) => {
        await enqueueWorkflowStart(name, input, opts);
      },
      log,
    });
  }, Math.max(
    10_000,
    parseInt(process.env.FTN_DESIGNER_SCHEDULER_INTERVAL_MS ?? "30000", 10)
  ));

  const shutdown = async () => {
    cancellation.aborted = true;
    if (recoverTimer) {
      clearInterval(recoverTimer);
    }
    clearInterval(designerSchedulerTimer);
    if (pool) {
      await pool.end();
    }
    if (redis) {
      await redis.quit();
    }
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
