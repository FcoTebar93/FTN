import type http from "node:http";
import type { WorkflowTask } from "../../../shared/tasks";
import { getWorkflow, getWorkflowDescriptor } from "../../../app/workflows";
import { matchHttpTrigger } from "../../../app/triggers";
import { readBodyCapped } from "../security";
import { validateJson } from "../../../shared/json-schema-validate";
import type { FtnAppRouteContext } from "../route-context";
import { getPathname } from "../url";

export async function tryWorkflowsRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _rawPath: string
): Promise<boolean> {
  const url = req.url ?? "";
  const hashInput = (value: unknown): string => {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  };

  if (req.method === "POST" && getPathname(url) === "/workflows") {
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const parsed = JSON.parse(body || "{}") as { name?: unknown; input?: unknown; workflowVersion?: unknown };
      const name = typeof parsed.name === "string" ? parsed.name : "";
      const workflowVersion =
        typeof parsed.workflowVersion === "string" && parsed.workflowVersion.trim()
          ? parsed.workflowVersion.trim()
          : undefined;
      if (!name) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing name" }));
        return true;
      }
      const input = parsed.input;
      const idempotencyKeyRaw = req.headers["idempotency-key"];
      const idempotencyKey =
        typeof idempotencyKeyRaw === "string" && idempotencyKeyRaw.trim()
          ? idempotencyKeyRaw.trim().slice(0, 200)
          : undefined;
      const inputHash = hashInput(input);
      if (idempotencyKey) {
        const previous = ctx.getIdempotentWorkflowStart(idempotencyKey);
        if (previous) {
          if (
            previous.name !== name ||
            previous.inputHash !== inputHash ||
            (previous.tenantId ?? "") !== (ctx.tenantId ?? "")
          ) {
            res.statusCode = 409;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "Idempotency key already used with a different payload",
              })
            );
            return true;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Idempotency-Replayed", "true");
          res.end(
            JSON.stringify({
              workflowId: previous.workflowId,
              runId: previous.runId,
              version: previous.version,
            })
          );
          return true;
        }
      }
      const { workflowId, runId, version } = await ctx.enqueueWorkflowStart(name, input, {
        correlationId: ctx.correlationId,
        tenantId: ctx.tenantId,
        workflowVersion,
      });
      if (idempotencyKey) {
        ctx.saveIdempotentWorkflowStart(idempotencyKey, {
          workflowId,
          runId,
          version,
          name,
          inputHash,
          tenantId: ctx.tenantId,
        });
      }

      res.statusCode = 201;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ workflowId, runId, version }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return true;
  }

  if (req.method === "GET" && (url === "/workflows" || url.startsWith("/workflows?"))) {
    const [, queryString] = url.split("?");
    const params = new URLSearchParams(queryString ?? "");
    const statusFilter = params.get("status") as "running" | "completed" | "failed" | "cancelled" | null;
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10)));
    const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10));

    const runKeys = await ctx.eventStore.listRunKeys();
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
      cancelledAt: string | undefined;
      cancellationReason: string | undefined;
      pendingActivities: number;
      pendingTimers: number;
      pendingSignalWaits: number;
      retryAttempts: number;
      lastEventType: string | undefined;
    }> = [];

    for (const { workflowId, runId } of slice) {
      const state = await ctx.runtime.loadCurrentState(workflowId, runId);
      if (!state) continue;

      const events = await ctx.eventStore.loadEvents(workflowId, runId, 0);
      const startEvent = events.find((e) => e.type === "WorkflowStarted");
      const name =
        startEvent && startEvent.type === "WorkflowStarted" ? startEvent.payload.name : "unknown";
      const retryAttempts = events.filter((e) => e.type === "RetryAttemptStarted").length;
      const lastEventType = events.length > 0 ? events[events.length - 1]!.type : undefined;

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
        cancelledAt: state.cancelledAt,
        cancellationReason: state.cancellationReason,
        pendingActivities: state.pendingActivities.length,
        pendingTimers: state.pendingTimers.length,
        pendingSignalWaits: state.pendingSignalWaits.length,
        retryAttempts,
        lastEventType,
      });
    }

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(summaries));
    return true;
  }

  const pathOnlyTrigger = getPathname(req.url);
  const trigger = matchHttpTrigger(req.method ?? "GET", pathOnlyTrigger);

  if (trigger) {
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const descriptor = getWorkflowDescriptor(trigger.workflowName);
      const wfDef = getWorkflow(trigger.workflowName, descriptor?.version);
      if (!wfDef) {
        res.statusCode = 500;
        res.end(`Workflow "${trigger.workflowName}" not registered`);
        return true;
      }
      const parsedBody = body ? JSON.parse(body) : undefined;
      const input = trigger.useBodyAsInput ? parsedBody : undefined;

      if (descriptor?.inputSchema) {
        const result = validateJson(descriptor.inputSchema, input);
        if (!result.valid) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid input", details: result.errors }));
          return true;
        }
      }

      const { workflowId, runId } = await ctx.runtime.startWorkflow({
        workflowName: trigger.workflowName,
        workflowVersion: descriptor?.version,
        tenantId: ctx.tenantId,
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
        correlationId: ctx.correlationId,
      };

      await ctx.taskQueue.enqueue(task);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ workflowId, runId }));
    } catch (e) {
      res.statusCode = 500;
      res.end(`Error handling trigger: ${(e as Error).message}`);
    }
    return true;
  }

  if (req.method === "GET" && url.startsWith("/workflows/") && url.endsWith("/events")) {
    const parts = getPathname(url).split("/");
    if (parts.length !== 5) {
      res.statusCode = 400;
      res.end("Expected /workflows/:workflowId/:runId/events");
      return true;
    }
    const workflowId = parts[2];
    const runId = parts[3];
    const events = await ctx.eventStore.loadEvents(workflowId, runId, 0);
    if (!events || events.length === 0) {
      res.statusCode = 404;
      res.end("No events found");
      return true;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(events));
    return true;
  }

  if (req.method === "GET" && url.startsWith("/workflows/") && url.endsWith("/steps")) {
    const parts = getPathname(url).split("/");
    if (parts.length !== 5) {
      res.statusCode = 400;
      res.end("Expected /workflows/:workflowId/:runId/steps");
      return true;
    }
    const workflowId = parts[2];
    const runId = parts[3];
    const state = await ctx.runtime.loadCurrentState(workflowId, runId);
    if (!state) {
      res.statusCode = 404;
      res.end("Workflow not found");
      return true;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state.steps));
    return true;
  }

  if (req.method === "GET" && url.startsWith("/workflows/")) {
    const pathOnlyWf = getPathname(url);
    const parts = pathOnlyWf.split("/");
    if (parts.length !== 4) {
      res.statusCode = 400;
      res.end("Expected /workflows/:workflowId/:runId");
      return true;
    }
    const workflowId = parts[2];
    const runId = parts[3];
    const state = await ctx.runtime.loadCurrentState(workflowId, runId);
    if (!state) {
      res.statusCode = 404;
      res.end("Workflow not found");
      return true;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return true;
  }

  if (req.method === "POST" && url.startsWith("/workflows/") && url.endsWith("/signals")) {
    const parts = url.split("/");
    if (parts.length !== 5) {
      res.statusCode = 400;
      res.end("Expected /workflows/:workflowId/:runId/signals");
      return true;
    }
    const workflowId = parts[2];
    const runId = parts[3];

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const parsed = JSON.parse(body || "{}");
      const { signalName, data } = parsed;

      const state = await ctx.runtime.loadCurrentState(workflowId, runId);
      if (!state) {
        res.statusCode = 404;
        res.end("Workflow not found");
        return true;
      }

      await ctx.eventStore.appendEvents(workflowId, runId, state.version, [
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
        correlationId: ctx.correlationId,
      };

      await ctx.taskQueue.enqueue(task);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 500;
      res.end(`Error sending signal: ${(e as Error).message}`);
    }
    return true;
  }

  if (req.method === "POST" && url.startsWith("/workflows/") && url.endsWith("/cancel")) {
    const pathOnly = getPathname(url);
    const pathParts = pathOnly.split("/");
    if (pathParts.length !== 5) {
      res.statusCode = 400;
      res.end("Expected /workflows/:workflowId/:runId/cancel");
      return true;
    }

    const workflowId = pathParts[2];
    const runId = pathParts[3];
    const state = await ctx.runtime.loadCurrentState(workflowId, runId);
    if (!state) {
      res.statusCode = 404;
      res.end("Workflow not found");
      return true;
    }
    if (state.status !== "running") {
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Workflow is already ${state.status}` }));
      return true;
    }

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    let reason: string | undefined;
    try {
      if (body.trim()) {
        const parsed = JSON.parse(body) as { reason?: unknown };
        reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : undefined;
      }
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }

    await ctx.eventStore.appendEvents(workflowId, runId, state.version, [
      {
        type: "WorkflowCancelRequested",
        workflowId,
        runId,
        payload: {
          ...(reason ? { reason } : {}),
          requestedBy: ctx.requestSubject,
        },
      },
    ]);

    const task: WorkflowTask = {
      id: `wf-task-cancel-${workflowId}-${runId}-${Date.now()}`,
      type: "workflow",
      workflowId,
      runId,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      workerType: "workflow",
      targetQueue: "workflows",
      correlationId: ctx.correlationId,
    };
    await ctx.taskQueue.enqueue(task);

    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, requested: true }));
    return true;
  }

  return false;
}
