import type http from "node:http";
import { readBodyCapped } from "../security";
import type { StoredWorkflow } from "../../../app/designer-types";
import {
  getDesignerRuntimeName,
  getStoredWorkflow,
  listStoredWorkflows,
  upsertStoredWorkflow,
} from "../../../app/designer-store";
import { normalizeStoredWorkflow, validateSchedule } from "../../../app/designer-schedule";
import { validateDesignerWorkflow } from "../../../app/designer-validate";
import { DESIGNER_KINDS } from "../../../app/designer-kinds";
import type { FtnAppRouteContext } from "../route-context";

export async function tryDesignerReadRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "GET" && req.url === "/designer/kinds") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(DESIGNER_KINDS));
    return true;
  }

  if (req.method === "GET" && (rawPath === "/integrations/status" || rawPath.startsWith("/integrations/status?"))) {
    const items = await ctx.getIntegrationsStatusForSubject(ctx.requestSubject);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ items }));
    return true;
  }

  if (req.method === "GET" && (req.url === "/designer/workflows" || req.url?.startsWith("/designer/workflows?"))) {
    const items = await listStoredWorkflows(ctx.requestSubject);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(items));
    return true;
  }

  if (req.method === "GET" && req.url?.startsWith("/designer/workflows/")) {
    const pathOnly = req.url.split("?")[0];
    const parts = pathOnly.split("/");
    if (parts.length !== 4) {
      res.statusCode = 400;
      res.end("Expected /designer/workflows/:id");
      return true;
    }

    const id = decodeURIComponent(parts[3]);
    const wf = await getStoredWorkflow(ctx.requestSubject, id);
    if (wf === undefined) {
      res.statusCode = 404;
      res.end("Designer workflow not found");
      return true;
    }

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(wf));
    return true;
  }

  return false;
}

export async function tryDesignerWriteRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "POST" && req.url === "/designer/workflows") {
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const parsed = JSON.parse(body || "{}") as StoredWorkflow;

      if (!parsed.id || !parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
        res.statusCode = 400;
        res.end("Invalid StoredWorkflow payload");
        return true;
      }

      if ((await getStoredWorkflow(ctx.requestSubject, parsed.id)) !== undefined) {
        res.statusCode = 409;
        res.end(`StoredWorkflow "${parsed.id}" already exists`);
        return true;
      }

      const normalized = normalizeStoredWorkflow(parsed);
      const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
      if (schedErr) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: schedErr }));
        return true;
      }

      const graphErr = validateDesignerWorkflow(normalized);
      if (graphErr) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: graphErr }));
        return true;
      }

      await upsertStoredWorkflow(ctx.requestSubject, normalized);

      if (normalized.schedule?.type === "instant") {
        try {
          await ctx.enqueueWorkflowStart(
            getDesignerRuntimeName(ctx.requestSubject, normalized.id),
            normalized.scheduledInput ?? {},
            { correlationId: ctx.correlationId, tenantId: ctx.tenantId }
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
          return true;
        }
      }

      res.setHeader("Content-Type", "application/json");
      res.statusCode = 201;
      res.end(JSON.stringify({ ok: true, id: normalized.id, version: normalized.version }));
    } catch (e) {
      res.statusCode = 400;
      res.end(`Invalid JSON: ${(e as Error).message}`);
    }
    return true;
  }

  if (req.method === "PUT" && req.url?.startsWith("/designer/workflows/")) {
    const pathOnly = req.url.split("?")[0];
    const parts = pathOnly.split("/");
    if (parts.length !== 4) {
      res.statusCode = 400;
      res.end("Expected /designer/workflows/:id");
      return true;
    }

    const id = decodeURIComponent(parts[3]);

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const parsed = JSON.parse(body || "{}") as StoredWorkflow;

      if (!parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
        res.statusCode = 400;
        res.end("Invalid StoredWorkflow payload");
        return true;
      }

      const stored: StoredWorkflow = { ...parsed, id };

      const normalized = normalizeStoredWorkflow(stored);
      const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
      if (schedErr) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: schedErr }));
        return true;
      }

      const graphErrPut = validateDesignerWorkflow(normalized);
      if (graphErrPut) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: graphErrPut }));
        return true;
      }

      await upsertStoredWorkflow(ctx.requestSubject, normalized);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, id: normalized.id, version: normalized.version }));
    } catch (e) {
      res.statusCode = 400;
      res.end(`Invalid JSON: ${(e as Error).message}`);
    }
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/designer/workflows/") && rawPath.endsWith("/test-run")) {
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[0] !== "designer" || parts[1] !== "workflows" || parts[3] !== "test-run") {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Expected POST /designer/workflows/:id/test-run" }));
      return true;
    }
    const id = decodeURIComponent(parts[2]);
    const wf = await getStoredWorkflow(ctx.requestSubject, id);
    if (wf === undefined) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Designer workflow not found" }));
      return true;
    }
    const bodyTr = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (bodyTr === null) return true;
    let input: unknown = wf.scheduledInput ?? {};
    try {
      if (bodyTr.trim()) {
        const parsedBody = JSON.parse(bodyTr) as { input?: unknown };
        if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) && "input" in parsedBody) {
          input = parsedBody.input;
        } else {
          input = parsedBody;
        }
      }
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return true;
    }
    try {
      const { workflowId, runId, version } = await ctx.enqueueWorkflowStart(
        getDesignerRuntimeName(ctx.requestSubject, id),
        input,
        { correlationId: ctx.correlationId, tenantId: ctx.tenantId }
      );
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

  return false;
}
