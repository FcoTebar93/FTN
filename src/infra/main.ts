import http from "node:http";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "./inmemory-event-store";
import { InMemorySnapshotStore } from "./inmemory-snapshot-store";
import { InMemoryTaskQueue } from "./inmemory-task-queue";
import { InMemoryWorkflowRuntime } from "./inmemory-workflow-runtime";
import { InMemoryActivityRegistry, validateOrderActivity, chargePaymentActivity, createShipmentActivity } from "../app/activities";
import { InMemoryActivityWorker } from "./inmemory-activity-worker";
import { InMemoryWorkflowWorker } from "./inmemory-workflow-worker";
import type { WorkflowTask } from "../shared/tasks";
import { getWorkflow } from "../app/workflows";
import { InMemoryTimerWorker } from "./inmemory-timer-worker";

const engine = new DefaultWorkflowEngine();
const eventStore = new InMemoryEventStore();
const snapshotStore = new InMemorySnapshotStore();
const taskQueue = new InMemoryTaskQueue();
const activities = new InMemoryActivityRegistry();

activities.register("validate-order", validateOrderActivity);
activities.register("charge-payment", chargePaymentActivity);
activities.register("create-shipment", createShipmentActivity);

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

const activityWorker = new InMemoryActivityWorker({
  taskQueue,
  activities,
  eventStore,
  snapshotStore,
  engine,
  activityQueueName: "activities",
});

const timerWorker = new InMemoryTimerWorker({
  taskQueue,
  queueName: "timers",
  workflowQueueName: "workflows",
  pollIntervalMs: 500,
});

const cancellation = { aborted: false };

workflowWorker.runForever(cancellation).catch(console.error);
activityWorker.runForever(cancellation).catch(console.error);
timerWorker.runForever(cancellation).catch(console.error);

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }

    if (req.method === "GET" && (req.url === "/workflows" || req.url.startsWith("/workflows?"))) {
      const [path, queryString] = req.url.split("?");
      const params = new URLSearchParams(queryString ?? "");
      const statusFilter = params.get("status") as "running" | "completed" | "failed" | null;
      const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10)));
      const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10));

      const runKeys = await (eventStore as import("./inmemory-event-store").InMemoryEventStore).listRunKeys();
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

    if (req.method === "POST" && req.url === "/workflows") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const { name, input } = parsed;

          const definition = getWorkflow(name);
          if (!definition) {
            res.statusCode = 404;
            res.end(`Workflow definition "${name}" not found`);
            return;
          }

          const { workflowId, runId } = await runtime.startWorkflow({
            workflowName: name,
            input,
            definition,
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
          res.end(`Error starting workflow: ${(e as Error).message}`);
        }
      });
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
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const { signalName, data } = parsed;

          await eventStore.appendEvents(workflowId, runId, 1, [
            {
              type: "SignalReceived",
              workflowId,
              runId,
              payload: {
                signalName,
                data,
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

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(`Error sending signal: ${(e as Error).message}`);
        }
      });
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
  console.log(`FTN Workflow Engine running on http://localhost:${PORT}`);
});