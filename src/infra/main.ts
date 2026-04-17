import { DefaultWorkflowEngine } from "../core/default-engine";

import { getWorkflow, getWorkflowDescriptor, listWorkflows } from "../app/workflows";

import { InMemoryActivityRegistry } from "../modules/activity-registry/inmemory-activity-registry";
import { registerIntegrations } from "../modules/integrations";
import { createRateLimiter } from "./http/security";
import { getUserPasswordHash, insertUser } from "./users";
import { normalizeAndValidateUsername, validatePlainPassword } from "./http/registration";
import { hashPassword } from "./passwords";

import { configureDesignerStore, loadAllFromDatabase, listSchedulerRows, recordScheduledFailure, recordScheduledRun } from "../app/designer-store";
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
import { loadAppConfig } from "./config";
import { registerShutdownHooks, startLifecycle } from "./bootstrap/lifecycle";

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
  const config = loadAppConfig();
  const log = createLogger({ useJson: config.logFormatJson });
  initFtnTelemetry({
    disabled: config.otelDisabled,
    serviceName: config.otelServiceName,
  });
  const engine = new DefaultWorkflowEngine();

  const { pool, eventStore, snapshotStore } = await bootstrapPersistence({
    log,
    engineDatabaseUrl: config.engineDatabaseUrl,
  });

  configureDesignerStore(pool);
  configureCredentialsStore(pool);

  const { redis, redisTaskQueue, taskQueue, redisUrl } = bootstrapTaskQueue({
    log,
    redisUrl: config.redisUrl,
    redisKeyPrefix: config.redisKeyPrefix,
  });

  const systemSubject = config.systemSubject;
  const integrationsConfig = await buildIntegrationsConfig({ config, pool, redis, redisUrl });

  const activities = new InMemoryActivityRegistry();
  registerIntegrations(activities, integrationsConfig);

  await loadAllFromDatabase();

  const {
    runtime,
    cancellation,
    listDeadLetters,
    requeueDeadLetter,
    acknowledgeDeadLetter,
  } = bootstrapWorkers({
    engine,
    eventStore,
    snapshotStore,
    taskQueue,
    activities,
    log,
    deadLetterMaxItems: config.deadLetterMaxItems,
    workflowConcurrencyRetryMaxAttempts: config.workflowConcurrencyRetryMaxAttempts,
    workflowConcurrencyRetryBaseDelayMs: config.workflowConcurrencyRetryBaseDelayMs,
    workflowConcurrencyRetryMaxDelayMs: config.workflowConcurrencyRetryMaxDelayMs,
    workflowConcurrencyRetryJitterRatio: config.workflowConcurrencyRetryJitterRatio,
  });

  const multiTenantEnabled = config.multiTenantEnabled;
  const tenantMaxConcurrentRuns = config.tenantMaxConcurrentRuns;
  const idempotencyTtlMs = config.idempotencyTtlMs;
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

  const apiSecurity = config.apiSecurity;
  logProductionEnvWarnings(log, config.rawEnv);
  const hasDbLogin = Boolean(pool && apiSecurity.jwtSecret);
  const rateLimiter = createRateLimiter(apiSecurity.rateLimitPerMinute);
  const refreshTtlSeconds = config.refreshTtlSeconds;

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
      env: config.rawEnv,
    });
  }

  if (pool && apiSecurity.jwtSecret) {
    const defaultUsernameRaw = config.defaultUserUsername;
    const defaultPasswordRaw = config.defaultUserPassword;
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

  const port = config.port;
  server.listen(port, () => {
    log.info("server.listen", { port, url: `http://localhost:${port}` });
  });

  const lifecycle = startLifecycle({
    cancellation,
    redisTaskQueue,
    recoverIntervalMs: config.recoverIntervalMs,
    staleLeaseMs: config.staleLeaseMs,
    designerSchedulerIntervalMs: config.designerSchedulerIntervalMs,
    listSchedulerRows,
    recordScheduledRun,
    recordScheduledFailure,
    startWorkflow: async (name, input, opts) => {
      await enqueueWorkflowStart(name, input, opts);
    },
    log,
  });
  registerShutdownHooks(lifecycle, { pool, redis, server });
}

void main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
