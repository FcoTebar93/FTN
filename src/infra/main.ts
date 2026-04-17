import { DefaultWorkflowEngine } from "../core/default-engine";

import { getWorkflow, getWorkflowDescriptor, listWorkflows } from "../app/workflows";

import { InMemoryActivityRegistry } from "../modules/activity-registry/inmemory-activity-registry";
import { registerIntegrations } from "../modules/integrations";
import { createRateLimiter, loadApiSecurityConfigFromEnv } from "./http/security";
import { getUserPasswordHash, insertUser } from "./users";
import { normalizeAndValidateUsername, validatePlainPassword } from "./http/registration";
import { hashPassword } from "./passwords";

import { configureDesignerStore, loadAllFromDatabase, listSchedulerRows, recordScheduledFailure, recordScheduledRun } from "../app/designer-store";
import { runScheduledWorkflowTick } from "../app/designer-scheduler";
import { configureCredentialsStore, getCredential } from "../app/credentials";
import { createLogger, type Logger } from "./logger";
import { buildIntegrationsStatusForSubject } from "./integrations-status";
import { initFtnTelemetry } from "./telemetry";
import { createWorkflowStartService } from "./workflow-start-service";
import { bootstrapPersistence } from "./bootstrap/persistence";
import { bootstrapTaskQueue } from "./bootstrap/task-queue";
import { buildIntegrationsConfig } from "./bootstrap/integrations";
import { bootstrapWorkers } from "./bootstrap/workers";
import { bootstrapHttpServer } from "./bootstrap/http";

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

  const { pool, eventStore, snapshotStore } = await bootstrapPersistence(log);

  configureDesignerStore(pool);
  configureCredentialsStore(pool);

  const { redis, redisTaskQueue, taskQueue, redisUrl } = bootstrapTaskQueue(log);

  const systemSubject = process.env.FTN_SYSTEM_SUBJECT?.trim() || "system";
  const integrationsConfig = await buildIntegrationsConfig({ pool, redis, redisUrl });

  const activities = new InMemoryActivityRegistry();
  registerIntegrations(activities, integrationsConfig);

  await loadAllFromDatabase();

  const {
    runtime,
    cancellation,
    listDeadLetters,
    requeueDeadLetter,
    acknowledgeDeadLetter,
  } = bootstrapWorkers({ engine, eventStore, snapshotStore, taskQueue, activities, log });

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

  const server = bootstrapHttpServer({
    pool,
    redis,
    apiSecurity,
    hasDbLogin,
    refreshTtlSeconds,
    systemSubject,
    multiTenantEnabled,
    rateLimiter,
    activities,
    runtime,
    eventStore,
    taskQueue,
    enqueueWorkflowStart,
    getIntegrationsStatusForSubject,
    getIdempotentWorkflowStart,
    saveIdempotentWorkflowStart,
    listDeadLetters,
    requeueDeadLetter,
    acknowledgeDeadLetter,
    listWorkflowsPublic: () =>
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
    getWorkflowPublicDescriptor: (name: string) => {
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
    log,
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
