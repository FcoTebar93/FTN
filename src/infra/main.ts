import http from "node:http";
import Stripe from "stripe";
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

import type { WorkflowTask } from "../shared/tasks";
import { getWorkflow, getWorkflowDescriptor, listWorkflows } from "../app/workflows";

import { InMemoryActivityRegistry } from "../modules/activity-registry/inmemory-activity-registry";
import { registerIntegrations } from "../modules/integrations";
import type { IntegrationsConfig } from "../modules/integrations";
import { DefaultActivityRuntime } from "../modules/activity-runtime";
import { ActivityWorker } from "../workers/activity-worker";
import { InMemoryActivityQueueWorker } from "./inmemory-activity-queue-worker";
import { matchHttpTrigger } from "../app/triggers";

import { handleCatalogRoutes } from "./http/catalog";
import { applyCorsHeaders, createRateLimiter, loadApiSecurityConfigFromEnv, readBodyCapped, getClientIp } from "./http/security";
import { authenticatePrincipal, checkProtectedAccess, isAuthConfigured, isLoginConfigured, issueAccessToken, issueAccessTokenForSubject, validateLoginCredentials } from "./http/auth";
import { normalizeAndValidateUsername, validatePlainPassword } from "./http/registration";
import { hashPassword, verifyPassword } from "./passwords";
import { getUserPasswordHash, insertUser } from "./users";

import { validateJson } from "../shared/json-schema-validate";
import { StoredWorkflow } from "../app/designer-types";
import { configureDesignerStore, getDesignerRuntimeName, getStoredWorkflow, listStoredWorkflows, upsertStoredWorkflow, loadAllFromDatabase, listSchedulerRows, recordScheduledRun } from "../app/designer-store";
import { runScheduledWorkflowTick } from "../app/designer-scheduler";
import { normalizeStoredWorkflow, validateSchedule } from "../app/designer-schedule";
import { configureCredentialsStore, getCredential, listCredentials, upsertCredential } from "../app/credentials";

import { DESIGNER_KINDS } from "../app/designer-kinds";
import { runPostgresMigrations } from "./postgres-migrations";
import { PostgresEventStore } from "./postgres-event-store";
import { PostgresSnapshotStore } from "./postgres-snapshot-store";
import { createLogger } from "./logger";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SWAGGER_UI_HTML } from "./swagger-ui";

async function main(): Promise<void> {
  const log = createLogger();
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

  const activityQueueWorker = new InMemoryActivityQueueWorker({
    taskQueue,
    worker: activityWorkerCore,
    queueName: "activities",
    workerId: "activity-worker-1",
    leaseTimeoutMs: 10_000,
    pollIntervalMs: 100,
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
    config: {
      queueName: "workflows",
      leaseTimeoutMs: 10_000,
      pollIntervalMs: 100,
    },
  });

  const timerWorker = new InMemoryTimerWorker({
    taskQueue,
    queueName: "timers",
    workflowQueueName: "workflows",
    pollIntervalMs: 500,
  });

  async function enqueueWorkflowStart(
    name: string,
    input: unknown
  ): Promise<{ workflowId: string; runId: string; version: number }> {
    const wfDef = getWorkflow(name);
    if (!wfDef) {
      throw new Error(`Workflow not found: ${name}`);
    }
    const descriptor = getWorkflowDescriptor(name);
    if (descriptor?.inputSchema) {
      const result = validateJson(descriptor.inputSchema, input);
      if (!result.valid) {
        throw new Error(`Invalid input: ${JSON.stringify(result.errors)}`);
      }
    }
    const { workflowId, runId, version } = await runtime.startWorkflow({
      workflowName: name,
      input,
      definition: wfDef,
    });
    const task: WorkflowTask = {
      id: `wf-task-${workflowId}-${runId}`,
      type: "workflow",
      workflowId,
      runId,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
    };
    await taskQueue.enqueue(task);
    return { workflowId, runId, version };
  }

  const cancellation = { aborted: false };

  workflowWorker.runForever(cancellation).catch((err) => log.error("workflowWorker.runForever", { err: String(err) }));
  timerWorker.runForever(cancellation).catch((err) => log.error("timerWorker.runForever", { err: String(err) }));
  activityQueueWorker.runForever(cancellation).catch((err) => log.error("activityQueueWorker.runForever", { err: String(err) }));

  const apiSecurity = loadApiSecurityConfigFromEnv();
  const rateLimiter = createRateLimiter(apiSecurity.rateLimitPerMinute);

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

    const rawPathEarly = (req.url ?? "").split("?")[0] ?? "";
    const methodEarly = req.method ?? "GET";

    const access = checkProtectedAccess(req, apiSecurity, methodEarly, rawPathEarly);
    if (access === "unauthorized") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (access === "forbidden") {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Forbidden", detail: "Insufficient scope" }));
      return;
    }
    const principal = authenticatePrincipal(req, apiSecurity);
    const requestSubject =
      principal?.subject ??
      (principal?.kind === "api_key" ? "api_key" : systemSubject);

    if (!rateLimiter(getClientIp(req, apiSecurity.trustProxy))) {
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
      if (!req.url || !req.method) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      const rawPath = req.url.split("?")[0] ?? "";

      if (req.method === "POST" && rawPath === "/auth/login") {
        if (!isLoginConfigured(apiSecurity)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;

        let parsed: { username?: unknown; password?: unknown };
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        const u = typeof parsed.username === "string" ? parsed.username : "";
        const p = typeof parsed.password === "string" ? parsed.password : "";

        let token: string;
        let expiresIn: number;

        if (validateLoginCredentials(apiSecurity, u, p)) {
          ({ token, expiresIn } = issueAccessToken(apiSecurity));
        } else if (pool && apiSecurity.jwtSecret) {
          const normalized = normalizeAndValidateUsername(u);
          if (!normalized) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid credentials" }));
            return;
          }
          const storedHash = await getUserPasswordHash(pool, normalized);
          if (!storedHash || !(await verifyPassword(p, storedHash))) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid credentials" }));
            return;
          }
          ({ token, expiresIn } = issueAccessTokenForSubject(apiSecurity, normalized));
        } else {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid credentials" }));
          return;
        }

        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            access_token: token,
            token_type: "Bearer",
            expires_in: expiresIn,
          })
        );
        return;
      }

      if (req.method === "POST" && rawPath === "/auth/register") {
        if (!pool || !apiSecurity.registrationEnabled || !apiSecurity.jwtSecret) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Registration is not available" }));
          return;
        }

        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;

        let parsed: { username?: unknown; password?: unknown };
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        const rawUser = typeof parsed.username === "string" ? parsed.username : "";
        const rawPass = typeof parsed.password === "string" ? parsed.password : "";
        const normalized = normalizeAndValidateUsername(rawUser);
        if (!normalized || !validatePlainPassword(rawPass)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: "Invalid username or password",
              detail:
                "Usuario: 3–64 caracteres (letras, números, _, ., -). Contraseña: mínimo 10 caracteres.",
            })
          );
          return;
        }

        const passwordHash = await hashPassword(rawPass);
        const inserted = await insertUser(pool, normalized, passwordHash);
        if (inserted === "duplicate") {
          res.statusCode = 409;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Username already taken" }));
          return;
        }

        const { token, expiresIn } = issueAccessTokenForSubject(apiSecurity, normalized);
        res.statusCode = 201;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            access_token: token,
            token_type: "Bearer",
            expires_in: expiresIn,
          })
        );
        return;
      }

      if (req.method === "GET" && rawPath === "/auth/status") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            loginConfigured: isLoginConfigured(apiSecurity),
            authRequired: isAuthConfigured(apiSecurity),
            registrationEnabled: Boolean(apiSecurity.registrationEnabled && pool),
          })
        );
        return;
      }

      if (req.method === "GET" && rawPath === "/health") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.method === "GET" && rawPath === "/openapi.json") {
        const specPath = join(process.cwd(), "docs/api/openapi.json");
        if (!existsSync(specPath)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "OpenAPI spec not found" }));
          return;
        }
        const raw = readFileSync(specPath, "utf8");
        res.setHeader("Content-Type", "application/json");
        res.end(raw);
        return;
      }

      if (req.method === "GET" && rawPath === "/docs") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(SWAGGER_UI_HTML);
        return;
      }

      if (req.method === "GET" && rawPath === "/swagger") {
        res.statusCode = 302;
        res.setHeader("Location", "/docs");
        res.end();
        return;
      }

      if (req.method === "GET" && rawPath === "/ready") {
        const checks: { postgres?: boolean; redis?: boolean } = {};
        if (pool) {
          try {
            await pool.query("SELECT 1");
            checks.postgres = true;
          } catch {
            checks.postgres = false;
          }
        }
        if (redis) {
          try {
            await redis.ping();
            checks.redis = true;
          } catch {
            checks.redis = false;
          }
        }
        const ok =
          (!pool || checks.postgres === true) &&
          (!redis || checks.redis === true);
        res.statusCode = ok ? 200 : 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: ok ? "ready" : "not_ready", checks }));
        return;
      }

      if (req.method === "GET" && req.url === "/designer/kinds") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(DESIGNER_KINDS));
        return;
      }

      if (req.method === "GET" && (req.url === "/designer/workflows" || req.url?.startsWith("/designer/workflows?"))) {
        const items = await listStoredWorkflows(requestSubject);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(items));
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/designer/workflows/")) {
        const pathOnly = req.url.split("?")[0];
        const parts = pathOnly.split("/");
        if (parts.length !== 4) {
          res.statusCode = 400;
          res.end("Expected /designer/workflows/:id");
          return;
        }

        const id = decodeURIComponent(parts[3]);
        const wf = await getStoredWorkflow(requestSubject, id);
        if (wf === undefined) {
          res.statusCode = 404;
          res.end("Designer workflow not found");
          return;
        }

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(wf));
        return;
      }

      if (req.method === "GET" && (rawPath === "/credentials" || rawPath.startsWith("/credentials?"))) {
        const items = await listCredentials(requestSubject);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(items));
        return;
      }

      if (req.method === "GET" && rawPath.startsWith("/credentials/")) {
        const parts = rawPath.split("/");
        if (parts.length !== 3 || !parts[2]) {
          res.statusCode = 400;
          res.end("Expected /credentials/:provider");
          return;
        }
        const provider = decodeURIComponent(parts[2]);
        const cred = await getCredential(requestSubject, provider);
        if (!cred) {
          res.statusCode = 404;
          res.end("Credential not found");
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(cred));
        return;
      }

      if (req.method === "PUT" && rawPath.startsWith("/credentials/")) {
        const parts = rawPath.split("/");
        if (parts.length !== 3 || !parts[2]) {
          res.statusCode = 400;
          res.end("Expected /credentials/:provider");
          return;
        }
        const provider = decodeURIComponent(parts[2]);
        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const parsed = JSON.parse(body || "{}") as {
            config?: unknown;
            secrets?: unknown;
          };
          const config =
            parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)
              ? (parsed.config as Record<string, unknown>)
              : undefined;
          const secrets =
            parsed.secrets && typeof parsed.secrets === "object" && !Array.isArray(parsed.secrets)
              ? (parsed.secrets as Record<string, unknown>)
              : undefined;
          if (!config && !secrets) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Payload must include config or secrets object" }));
            return;
          }
          const saved = await upsertCredential(requestSubject, provider, { config, secrets });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(saved));
        } catch (e) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      if (req.method === "POST" && req.url === "/designer/workflows") {
        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const parsed = JSON.parse(body || "{}") as StoredWorkflow;

          if (!parsed.id || !parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
            res.statusCode = 400;
            res.end("Invalid StoredWorkflow payload");
            return;
          }

          if ((await getStoredWorkflow(requestSubject, parsed.id)) !== undefined) {
            res.statusCode = 409;
            res.end(`StoredWorkflow "${parsed.id}" already exists`);
            return;
          }

          const normalized = normalizeStoredWorkflow(parsed);
          const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
          if (schedErr) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: schedErr }));
            return;
          }

          await upsertStoredWorkflow(requestSubject, normalized);

          if (normalized.schedule?.type === "instant") {
            try {
              await enqueueWorkflowStart(
                getDesignerRuntimeName(requestSubject, normalized.id),
                normalized.scheduledInput ?? {}
              );
            } catch (e) {
              res.statusCode = 201;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: true,
                  id: normalized.id,
                  version: normalized.version,
                  instantRunError: String((e as Error).message),
                })
              );
              return;
            }
          }

          res.setHeader("Content-Type", "application/json");
          res.statusCode = 201;
          res.end(JSON.stringify({ ok: true, id: normalized.id, version: normalized.version }));
        } catch (e) {
          res.statusCode = 400;
          res.end(`Invalid JSON: ${(e as Error).message}`);
        }
        return;
      }

      if (req.method === "PUT" && req.url?.startsWith("/designer/workflows/")) {
        const pathOnly = req.url.split("?")[0];
        const parts = pathOnly.split("/");
        if (parts.length !== 4) {
          res.statusCode = 400;
          res.end("Expected /designer/workflows/:id");
          return;
        }

        const id = decodeURIComponent(parts[3]);

        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const parsed = JSON.parse(body || "{}") as StoredWorkflow;

          if (!parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
            res.statusCode = 400;
            res.end("Invalid StoredWorkflow payload");
            return;
          }

          const stored: StoredWorkflow = { ...parsed, id };

          const normalized = normalizeStoredWorkflow(stored);
          const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
          if (schedErr) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: schedErr }));
            return;
          }

          await upsertStoredWorkflow(requestSubject, normalized);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, id: normalized.id, version: normalized.version }));
        } catch (e) {
          res.statusCode = 400;
          res.end(`Invalid JSON: ${(e as Error).message}`);
        }
        return;
      }

      if (req.method === "POST" && rawPath === "/workflows") {
        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const parsed = JSON.parse(body || "{}") as { name?: unknown; input?: unknown };
          const name = typeof parsed.name === "string" ? parsed.name : "";
          if (!name) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing name" }));
            return;
          }
          const input = parsed.input;
          const { workflowId, runId, version } = await enqueueWorkflowStart(name, input);

          res.statusCode = 201;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ workflowId, runId, version }));
        } catch (e) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      if (req.method === "GET" && (req.url === "/workflows" || req.url.startsWith("/workflows?"))) {
        const [, queryString] = req.url.split("?");
        const params = new URLSearchParams(queryString ?? "");
        const statusFilter = params.get("status") as "running" | "completed" | "failed" | null;
        const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10)));
        const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10));

        const runKeys = await eventStore.listRunKeys();
        const slice = runKeys.slice(offset, offset + limit);

        const summaries: Array<{
          workflowId: string;
          runId: string;
          name: string;
          status: string;
          startedAt: string | undefined;
          completedAt: string | undefined;
          failedAt: string | undefined;
          failureReason: string | undefined;
        }> = [];

        for (const { workflowId, runId } of slice) {
          const state = await runtime.loadCurrentState(workflowId, runId);
          if (!state) continue;

          const events = await eventStore.loadEvents(workflowId, runId, 0);
          const startEvent = events.find((e) => e.type === "WorkflowStarted");
          const name =
            startEvent && startEvent.type === "WorkflowStarted"
              ? startEvent.payload.name
              : "unknown";

          if (statusFilter && state.status !== statusFilter) continue;

          summaries.push({
            workflowId,
            runId,
            name,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            failedAt: state.failedAt,
            failureReason: state.failureReason,
          });
        }

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(summaries));
        return;
      }

      const pathOnlyTrigger = (req.url ?? "").split("?")[0];
      const trigger = matchHttpTrigger(req.method ?? "GET", pathOnlyTrigger);

      if (trigger) {
        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const wfDef = getWorkflow(trigger.workflowName);
          if (!wfDef) {
            res.statusCode = 500;
            res.end(`Workflow "${trigger.workflowName}" not registered`);
            return;
          }

          const descriptor = getWorkflowDescriptor(trigger.workflowName);
          const parsedBody = body ? JSON.parse(body) : undefined;
          const input = trigger.useBodyAsInput ? parsedBody : undefined;

          if (descriptor?.inputSchema) {
            const result = validateJson(descriptor.inputSchema, input);
            if (!result.valid) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Invalid input", details: result.errors }));
              return;
            }
          }

          const { workflowId, runId } = await runtime.startWorkflow({
            workflowName: trigger.workflowName,
            input,
            definition: wfDef,
          });

          const task: WorkflowTask = {
            id: `wf-task-${workflowId}-${runId}`,
            type: "workflow",
            workflowId,
            runId,
            createdAt: new Date().toISOString(),
            scheduledAt: new Date().toISOString(),
            workerType: "workflow",
            targetQueue: "workflows",
          };

          await taskQueue.enqueue(task);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ workflowId, runId }));
        } catch (e) {
          res.statusCode = 500;
          res.end(`Error handling trigger: ${(e as Error).message}`);
        }
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/workflows/") && req.url.endsWith("/events")) {
        const parts = req.url.split("?")[0].split("/");
        if (parts.length !== 5) {
          res.statusCode = 400;
          res.end("Expected /workflows/:workflowId/:runId/events");
          return;
        }
        const workflowId = parts[2];
        const runId = parts[3];
        const events = await eventStore.loadEvents(workflowId, runId, 0);
        if (!events || events.length === 0) {
          res.statusCode = 404;
          res.end("No events found");
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(events));
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/workflows/") && req.url.endsWith("/steps")) {
        const parts = req.url.split("?")[0].split("/");
        if (parts.length !== 5) {
          res.statusCode = 400;
          res.end("Expected /workflows/:workflowId/:runId/steps");
          return;
        }
        const workflowId = parts[2];
        const runId = parts[3];
        const state = await runtime.loadCurrentState(workflowId, runId);
        if (!state) {
          res.statusCode = 404;
          res.end("Workflow not found");
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(state.steps));
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/workflows/")) {
        const pathOnlyWf = req.url.split("?")[0];
        const parts = pathOnlyWf.split("/");
        if (parts.length !== 4) {
          res.statusCode = 400;
          res.end("Expected /workflows/:workflowId/:runId");
          return;
        }
        const workflowId = parts[2];
        const runId = parts[3];
        const state = await runtime.loadCurrentState(workflowId, runId);
        if (!state) {
          res.statusCode = 404;
          res.end("Workflow not found");
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(state));
        return;
      }

      if (req.method === "POST" && req.url.startsWith("/workflows/") && req.url.endsWith("/signals")) {
        const parts = req.url.split("/");
        if (parts.length !== 5) {
          res.statusCode = 400;
          res.end("Expected /workflows/:workflowId/:runId/signals");
          return;
        }
        const workflowId = parts[2];
        const runId = parts[3];

        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const parsed = JSON.parse(body || "{}");
          const { signalName, data } = parsed;

          const state = await runtime.loadCurrentState(workflowId, runId);
          if (!state) {
            res.statusCode = 404;
            res.end("Workflow not found");
            return;
          }

          await eventStore.appendEvents(workflowId, runId, state.version, [
            {
              type: "SignalReceived",
              workflowId,
              runId,
              payload: { signalName, data },
            },
          ]);

          const task: WorkflowTask = {
            id: `wf-task-signal-${workflowId}-${runId}-${Date.now()}`,
            type: "workflow",
            workflowId,
            runId,
            createdAt: new Date().toISOString(),
            scheduledAt: new Date().toISOString(),
            workerType: "workflow",
            targetQueue: "workflows",
          };

          await taskQueue.enqueue(task);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(`Error sending signal: ${(e as Error).message}`);
        }
        return;
      }

      if (req.method === "POST" && req.url === "/pay/checkout") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body || "{}");
            const { successUrl, cancelUrl, customerEmail, currency, lineItems, metadata } = parsed;

            const key = process.env.STRIPE_SECRET_KEY;
            if (!key) {
              res.statusCode = 500;
              res.end("STRIPE_SECRET_KEY not configured");
              return;
            }

            const stripe = new Stripe(key, { apiVersion: "2024-06-20" as any });
            const session = await stripe.checkout.sessions.create({
              mode: "payment",
              success_url: successUrl,
              cancel_url: cancelUrl,
              customer_email: customerEmail,
              currency,
              line_items: lineItems.map((li: any) => ({
                quantity: li.quantity,
                price_data: {
                  currency,
                  unit_amount: li.unitAmountCents,
                  product_data: { name: li.name },
                },
              })),
              metadata,
            });

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ sessionId: session.id, url: session.url }));
          } catch (e) {
            res.statusCode = 500;
            res.end(`Error creating checkout: ${(e as Error).message}`);
          }
        });
        return;
      }

      if (req.method === "POST" && req.url === "/stripe/webhook") {
        const sig = req.headers["stripe-signature"];
        const body = await readBodyCapped(req, res, apiSecurity.maxBodyBytes);
        if (body === null) return;
        try {
          const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
          const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
          if (!webhookSecret || !stripeSecretKey) {
            res.statusCode = 500;
            res.end("Stripe secrets not configured");
            return;
          }

          const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" as any });
          const event = stripe.webhooks.constructEvent(body, sig as string, webhookSecret);

          if (event.type === "checkout.session.completed") {
            const session: any = event.data.object;
            const md = session.metadata || {};
            const workflowId = md.workflowId;
            const runId = md.runId;

            if (workflowId && runId) {
              const state = await runtime.loadCurrentState(workflowId, runId);
              if (state) {
                await eventStore.appendEvents(workflowId, runId, state.version, [
                  {
                    type: "SignalReceived",
                    workflowId,
                    runId,
                    payload: {
                      signalName: "payment-completed",
                      data: {
                        sessionId: session.id,
                        amountTotal: session.amount_total,
                        currency: session.currency,
                        customerEmail: session.customer_details?.email,
                      },
                    },
                  },
                ]);

                const task: WorkflowTask = {
                  id: `wf-task-signal-${workflowId}-${runId}-${Date.now()}`,
                  type: "workflow",
                  workflowId,
                  runId,
                  createdAt: new Date().toISOString(),
                  scheduledAt: new Date().toISOString(),
                  workerType: "workflow",
                  targetQueue: "workflows",
                };

                await taskQueue.enqueue(task);
              }
            }
          }

          res.statusCode = 200;
          res.end("[OK] webhook processed");
        } catch (err) {
          res.statusCode = 400;
          res.end(`Webhook error: ${(err as Error).message}`);
        }

        return;
      }

      if (req.method === "GET" && (req.url === "/activities" || req.url.startsWith("/activities?"))) {
        const [, queryString] = req.url.split("?");
        const params = new URLSearchParams(queryString ?? "");
        const tag = params.get("tag");
        const module = params.get("module");
        const q = params.get("q")?.toLowerCase();

        const defs = tag ? activities.listByTag(tag) : activities.list();

        const filtered = defs.filter((def) => {
          const mod = def.name.split(".")[0];
          if (module && mod !== module) return false;
          if (q && !def.name.toLowerCase().includes(q)) return false;
          return true;
        });

        const out = filtered.map((def) => ({
          name: def.name,
          module: def.name.split(".")[0],
          version: def.version,
          tags: def.tags ?? [],
          timeoutMs: def.timeoutMs ?? null,
          maxAttempts: def.maxAttempts ?? null,
        }));

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
        return;
      }

      if (req.method === "GET" && req.url.startsWith("/activities/")) {
        const pathOnlyAct = req.url.split("?")[0];
        const parts = pathOnlyAct.split("/");
        if (parts.length !== 3) {
          res.statusCode = 400;
          res.end("Expected /activities/:name");
          return;
        }

        const name = decodeURIComponent(parts[2]);
        const def = activities.get(name as any);
        if (!def) {
          res.statusCode = 404;
          res.end("Activity not found");
          return;
        }

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          name: def.name,
          module: def.name.split(".")[0],
          version: def.version,
          tags: def.tags ?? [],
          timeoutMs: def.timeoutMs ?? null,
          maxAttempts: def.maxAttempts ?? null,
        }));
        return;
      }

      res.statusCode = 404;
      res.end("Not found");
    } catch (err) {
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
      startWorkflow: async (name, input) => {
        await enqueueWorkflowStart(name, input);
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
