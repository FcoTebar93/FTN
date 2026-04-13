import type http from "node:http";
import type { WorkflowTask } from "../../../shared/tasks";
import { getWorkflow, getWorkflowDescriptor } from "../../../app/workflows";
import { matchHttpTrigger } from "../../../app/triggers";
import { readBodyCapped } from "../security";
import { validateJson } from "../../../shared/json-schema-validate";
import type { FtnAppRouteContext } from "../route-context";

export async function tryWorkflowsRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _rawPath: string
): Promise<boolean> {
  const url = req.url ?? "";

  if (req.method === "POST" && url.split("?")[0] === "/workflows") {
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const parsed = JSON.parse(body || "{}") as { name?: unknown; input?: unknown };
      const name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing name" }));
        return true;
      }
      const input = parsed.input;
      const { workflowId, runId, version } = await ctx.enqueueWorkflowStart(name, input);

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
    const statusFilter = params.get("status") as "running" | "completed" | "failed" | null;
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
    }> = [];

    for (const { workflowId, runId } of slice) {
      const state = await ctx.runtime.loadCurrentState(workflowId, runId);
      if (!state) continue;

      const events = await ctx.eventStore.loadEvents(workflowId, runId, 0);
      const startEvent = events.find((e) => e.type === "WorkflowStarted");
      const name =
        startEvent && startEvent.type === "WorkflowStarted" ? startEvent.payload.name : "unknown";

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
    return true;
  }

  const pathOnlyTrigger = (req.url ?? "").split("?")[0];
  const trigger = matchHttpTrigger(req.method ?? "GET", pathOnlyTrigger);

  if (trigger) {
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const wfDef = getWorkflow(trigger.workflowName);
      if (!wfDef) {
        res.statusCode = 500;
        res.end(`Workflow "${trigger.workflowName}" not registered`);
        return true;
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
          return true;
        }
      }

      const { workflowId, runId } = await ctx.runtime.startWorkflow({
        workflowName: trigger.workflowName,
        workflowVersion: descriptor?.version,
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
    const parts = url.split("?")[0].split("/");
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
    const parts = url.split("?")[0].split("/");
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
    const pathOnlyWf = url.split("?")[0];
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

  return false;
}
