import http from "node:http";
import Stripe from "stripe";
import { Pool } from "pg";

import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "./inmemory-event-store";
import { InMemorySnapshotStore } from "./inmemory-snapshot-store";
import { InMemoryTaskQueue } from "./inmemory-task-queue";
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

import { handleCatalogRoutes } from "./http/catalog-routes";

import { validateJson } from "../shared/json-schema-validate";
import { StoredWorkflow } from "../app/designer-types";
import { getStoredWorkflow, listStoredWorkflows, upsertStoredWorkflow } from "../app/designer-store";

import { DESIGNER_KINDS } from "../app/designer-kinds";
import { runPostgresMigrations } from "./postgres-migrations";
import { PostgresEventStore } from "./postgres-event-store";
import { PostgresSnapshotStore } from "./postgres-snapshot-store";
import { createLogger } from "./logger";

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

  const eventStore = pool ? new PostgresEventStore(pool) : new InMemoryEventStore();
  const snapshotStore = pool ? new PostgresSnapshotStore(pool) : new InMemorySnapshotStore();
  const taskQueue = new InMemoryTaskQueue();

  const integrationsConfig: IntegrationsConfig = {
    storage: {
      enabled: !!process.env.DATABASE_URL,
      databaseUrl: process.env.DATABASE_URL,
    },
    documents: {
      enabled: true,
    },
    notifications: {
      enabled: true,
      sendgridApiKey: process.env.SENDGRID_API_KEY,
      emailFrom: process.env.EMAIL_FROM ?? process.env.SMTP_FROM,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    },
    payments: {
      enabled: !!process.env.STRIPE_SECRET_KEY,
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    },
    identity: {
      enabled: true,
    },
  };

  const activities = new InMemoryActivityRegistry();
  registerIntegrations(activities, integrationsConfig);

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

  const cancellation = { aborted: false };

  workflowWorker.runForever(cancellation).catch((err) => log.error("workflowWorker.runForever", { err: String(err) }));
  timerWorker.runForever(cancellation).catch((err) => log.error("timerWorker.runForever", { err: String(err) }));
  activityQueueWorker.runForever(cancellation).catch((err) => log.error("activityQueueWorker.runForever", { err: String(err) }));

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
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

      if (req.method === "GET" && rawPath === "/health") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.method === "GET" && req.url === "/designer/kinds") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(DESIGNER_KINDS));
        return;
      }

      if (req.method === "GET" && (req.url === "/designer/workflows" || req.url?.startsWith("/designer/workflows?"))) {
        const items = listStoredWorkflows();
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
        const wf = getStoredWorkflow(id);
        if (wf === undefined) {
          res.statusCode = 404;
          res.end("Designer workflow not found");
          return;
        }

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(wf));
        return;
      }

      if (req.method === "POST" && req.url === "/designer/workflows") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body || "{}") as StoredWorkflow;

            if (!parsed.id || !parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
              res.statusCode = 400;
              res.end("Invalid StoredWorkflow payload");
              return;
            }

            if (getStoredWorkflow(parsed.id) !== undefined) {
              res.statusCode = 409;
              res.end(`StoredWorkflow "${parsed.id}" already exists`);
              return;
            }

            upsertStoredWorkflow(parsed);

            res.setHeader("Content-Type", "application/json");
            res.statusCode = 201;
            res.end(JSON.stringify({ ok: true, id: parsed.id, version: parsed.version }));
          } catch (e) {
            res.statusCode = 400;
            res.end(`Invalid JSON: ${(e as Error).message}`);
          }
        });
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

        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body || "{}") as StoredWorkflow;

            if (!parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
              res.statusCode = 400;
              res.end("Invalid StoredWorkflow payload");
              return;
            }

            const stored: StoredWorkflow = { ...parsed, id };

            upsertStoredWorkflow(stored);

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, id: stored.id, version: stored.version }));
          } catch (e) {
            res.statusCode = 400;
            res.end(`Invalid JSON: ${(e as Error).message}`);
          }
        });
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
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
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
        });
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

        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
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
        });
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
        let body = "";

        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
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
        });

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

  const shutdown = async () => {
    cancellation.aborted = true;
    if (pool) {
      await pool.end();
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
