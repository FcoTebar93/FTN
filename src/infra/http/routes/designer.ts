import type http from "node:http";
import { sendError, sendJson } from "../response";
import type { StoredWorkflow } from "../../../app/designer-types";
import {
  getDesignerRuntimeName,
  getStoredWorkflow,
  listStoredWorkflows,
  upsertStoredWorkflow,
} from "../../../app/designer-store";
import {
  getUserTemplate,
  listUserTemplates,
  restoreUserTemplate,
  upsertUserTemplate,
  workflowFromTemplate,
} from "../../../app/designer-template-store";
import { getSystemTemplate } from "../../../app/system-templates";
import { normalizeStoredWorkflow, validateSchedule } from "../../../app/designer-schedule";
import { validateDesignerWorkflow } from "../../../app/designer-validate";
import { DESIGNER_KINDS } from "../../../app/designer-kinds";
import type { FtnAppRouteContext } from "../route-context";
import { getPathname } from "../url";
import { getPathParams } from "../path-params";
import { readJsonBodyCapped } from "../request";

export async function tryDesignerReadRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "GET" && req.url === "/designer/kinds") {
    sendJson(res, 200, DESIGNER_KINDS);
    return true;
  }

  if (req.method === "GET" && (rawPath === "/integrations/status" || rawPath.startsWith("/integrations/status?"))) {
    const items = await ctx.getIntegrationsStatusForSubject(ctx.requestSubject);
    sendJson(res, 200, { items });
    return true;
  }

  if (req.method === "GET" && (req.url === "/designer/workflows" || req.url?.startsWith("/designer/workflows?"))) {
    const items = await listStoredWorkflows(ctx.requestSubject);
    sendJson(res, 200, items);
    return true;
  }

  if (req.method === "GET" && (req.url === "/designer/templates" || req.url?.startsWith("/designer/templates?"))) {
    const items = await listUserTemplates(ctx.requestSubject);
    const enriched = items.map((item) => ({
      ...item,
      requiredActivities:
        getSystemTemplate(item.sourceTemplateId ?? item.id)?.requiredActivities ?? [],
    }));
    sendJson(res, 200, enriched);
    return true;
  }

  if (req.method === "GET" && req.url?.startsWith("/designer/templates/")) {
    const pathOnly = getPathname(req.url);
    const parts = getPathParams(pathOnly, 4);
    if (!parts) {
      sendError(res, 400, "Expected /designer/templates/:id");
      return true;
    }
    const id = decodeURIComponent(parts[3]);
    const tpl = await getUserTemplate(ctx.requestSubject, id);
    if (!tpl) {
      sendError(res, 404, "Designer template not found");
      return true;
    }
    sendJson(res, 200, tpl);
    return true;
  }

  if (req.method === "GET" && req.url?.startsWith("/designer/workflows/")) {
    const pathOnly = getPathname(req.url);
    const parts = getPathParams(pathOnly, 4);
    if (!parts) {
      sendError(res, 400, "Expected /designer/workflows/:id");
      return true;
    }

    const id = decodeURIComponent(parts[3]);
    const wf = await getStoredWorkflow(ctx.requestSubject, id);
    if (wf === undefined) {
      sendError(res, 404, "Designer workflow not found");
      return true;
    }

    sendJson(res, 200, wf);
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
    const parsedResult = await readJsonBodyCapped<StoredWorkflow>(req, res, ctx.apiSecurity.maxBodyBytes, {
      invalidJsonMessage: "Invalid JSON",
    });
    if (!parsedResult.ok) return true;
    const parsed = parsedResult.value;

    if (!parsed.id || !parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
      sendError(res, 400, "Invalid StoredWorkflow payload");
      return true;
    }

    if ((await getStoredWorkflow(ctx.requestSubject, parsed.id)) !== undefined) {
      sendError(res, 409, `StoredWorkflow "${parsed.id}" already exists`);
      return true;
    }

    const normalized = normalizeStoredWorkflow(parsed);
    const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
    if (schedErr) {
      sendError(res, 400, schedErr);
      return true;
    }

    const graphErr = validateDesignerWorkflow(normalized);
    if (graphErr) {
      sendError(res, 400, graphErr);
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
        sendJson(res, 201, {
          ok: true,
          id: normalized.id,
          version: normalized.version,
          instantRunError: String((e as Error).message),
        });
        return true;
      }
    }

    sendJson(res, 201, { ok: true, id: normalized.id, version: normalized.version });
    return true;
  }

  if (req.method === "PUT" && req.url?.startsWith("/designer/workflows/")) {
    const pathOnly = getPathname(req.url);
    const parts = getPathParams(pathOnly, 4);
    if (!parts) {
      sendError(res, 400, "Expected /designer/workflows/:id");
      return true;
    }

    const id = decodeURIComponent(parts[3]);
    const parsedResult = await readJsonBodyCapped<StoredWorkflow>(req, res, ctx.apiSecurity.maxBodyBytes, {
      invalidJsonMessage: "Invalid JSON",
    });
    if (!parsedResult.ok) return true;
    const parsed = parsedResult.value;

    if (!parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
      sendError(res, 400, "Invalid StoredWorkflow payload");
      return true;
    }

    const stored: StoredWorkflow = { ...parsed, id };

    const normalized = normalizeStoredWorkflow(stored);
    const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
    if (schedErr) {
      sendError(res, 400, schedErr);
      return true;
    }

    const graphErrPut = validateDesignerWorkflow(normalized);
    if (graphErrPut) {
      sendError(res, 400, graphErrPut);
      return true;
    }

    await upsertStoredWorkflow(ctx.requestSubject, normalized);

    sendJson(res, 200, { ok: true, id: normalized.id, version: normalized.version });
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/designer/workflows/") && rawPath.endsWith("/test-run")) {
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[0] !== "designer" || parts[1] !== "workflows" || parts[3] !== "test-run") {
      sendError(res, 400, "Expected POST /designer/workflows/:id/test-run");
      return true;
    }
    const id = decodeURIComponent(parts[2]);
    const wf = await getStoredWorkflow(ctx.requestSubject, id);
    if (wf === undefined) {
      sendError(res, 404, "Designer workflow not found");
      return true;
    }
    let input: unknown = wf.scheduledInput ?? {};

    const bodyTrResult = await readJsonBodyCapped<unknown>(req, res, ctx.apiSecurity.maxBodyBytes, {
      emptyAs: undefined,
      invalidJsonMessage: "Invalid JSON body",
    });
    if (!bodyTrResult.ok) return true;
    const parsedBody = bodyTrResult.value;
    if (parsedBody !== undefined) {
      if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) && "input" in parsedBody) {
        input = (parsedBody as { input?: unknown }).input;
      } else {
        input = parsedBody;
      }
    }
    try {
      const { workflowId, runId, version } = await ctx.enqueueWorkflowStart(
        getDesignerRuntimeName(ctx.requestSubject, id),
        input,
        { correlationId: ctx.correlationId, tenantId: ctx.tenantId }
      );
      sendJson(res, 201, { workflowId, runId, version });
    } catch (e) {
      sendError(res, 400, (e as Error).message);
    }
    return true;
  }

  if (req.method === "PUT" && req.url?.startsWith("/designer/templates/")) {
    const pathOnly = getPathname(req.url);
    const parts = getPathParams(pathOnly, 4);
    if (!parts) {
      sendError(res, 400, "Expected /designer/templates/:id");
      return true;
    }
    const id = decodeURIComponent(parts[3]);
    const parsedResult = await readJsonBodyCapped<{
      payload: StoredWorkflow;
      label?: string;
      description?: string;
    }>(req, res, ctx.apiSecurity.maxBodyBytes, { invalidJsonMessage: "Invalid JSON" });
    if (!parsedResult.ok) return true;
    const { payload, label, description } = parsedResult.value;
    if (!payload?.displayName || !payload.steps || !payload.entryStepId) {
      sendError(res, 400, "Invalid template payload");
      return true;
    }
    const normalized = normalizeStoredWorkflow({ ...payload, id });
    const schedErrTpl = validateSchedule(normalized.schedule ?? { type: "instant" });
    if (schedErrTpl) {
      sendError(res, 400, schedErrTpl);
      return true;
    }
    const graphErrTpl = validateDesignerWorkflow(normalized);
    if (graphErrTpl) {
      sendError(res, 400, graphErrTpl);
      return true;
    }
    const saved = await upsertUserTemplate(ctx.requestSubject, id, normalized, { label, description });
    sendJson(res, 200, { ok: true, id: saved.id, isCustom: saved.isCustom });
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/designer/templates/") && rawPath.endsWith("/restore")) {
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[0] !== "designer" || parts[1] !== "templates" || parts[3] !== "restore") {
      sendError(res, 400, "Expected POST /designer/templates/:id/restore");
      return true;
    }
    const id = decodeURIComponent(parts[2]);
    const restored = await restoreUserTemplate(ctx.requestSubject, id);
    if (!restored) {
      sendError(res, 404, "System template not found");
      return true;
    }
    sendJson(res, 200, { ok: true, id: restored.id, isCustom: false });
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/designer/templates/") && rawPath.endsWith("/create-workflow")) {
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[0] !== "designer" || parts[1] !== "templates" || parts[3] !== "create-workflow") {
      sendError(res, 400, "Expected POST /designer/templates/:id/create-workflow");
      return true;
    }
    const templateId = decodeURIComponent(parts[2]);
    const tpl = await getUserTemplate(ctx.requestSubject, templateId);
    if (!tpl) {
      sendError(res, 404, "Designer template not found");
      return true;
    }
    const bodyResult = await readJsonBodyCapped<{ id?: string; displayName?: string }>(
      req,
      res,
      ctx.apiSecurity.maxBodyBytes,
      { emptyAs: {}, invalidJsonMessage: "Invalid JSON" }
    );
    if (!bodyResult.ok) return true;
    const newId = bodyResult.value.id?.trim();
    if (!newId) {
      sendError(res, 400, "Field 'id' is required");
      return true;
    }
    if ((await getStoredWorkflow(ctx.requestSubject, newId)) !== undefined) {
      sendError(res, 409, `StoredWorkflow "${newId}" already exists`);
      return true;
    }
    const wf = workflowFromTemplate(tpl.payload, {
      id: newId,
      displayName: bodyResult.value.displayName ?? tpl.label,
    });
    const schedErrWf = validateSchedule(wf.schedule ?? { type: "instant" });
    if (schedErrWf) {
      sendError(res, 400, schedErrWf);
      return true;
    }
    const graphErrWf = validateDesignerWorkflow(wf);
    if (graphErrWf) {
      sendError(res, 400, graphErrWf);
      return true;
    }
    await upsertStoredWorkflow(ctx.requestSubject, wf);
    sendJson(res, 201, { ok: true, id: wf.id, version: wf.version });
    return true;
  }

  return false;
}
