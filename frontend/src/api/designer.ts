import { fetchJson, postJson, putJson } from "./client";
import type { DesignerKind, ActivityCatalogItem } from "./types";
import type { DesignerWorkflowSummary, DesignerStoredWorkflow, DesignerTemplateSummary, DesignerTemplateRecord } from "./types";
import type { IntegrationStatusItem } from "./types";

export function getDesignerTemplates(): Promise<DesignerTemplateSummary[]> {
  return fetchJson<DesignerTemplateSummary[]>("/designer/templates");
}

export function getDesignerTemplate(id: string): Promise<DesignerTemplateRecord> {
  return fetchJson<DesignerTemplateRecord>(`/designer/templates/${encodeURIComponent(id)}`);
}

export async function updateDesignerTemplate(
  id: string,
  body: { payload: DesignerStoredWorkflow; label?: string; description?: string }
): Promise<void> {
  await putJson(`/designer/templates/${encodeURIComponent(id)}`, body);
}

export async function restoreDesignerTemplate(id: string): Promise<void> {
  await postJson(`/designer/templates/${encodeURIComponent(id)}/restore`, {});
}

export async function createWorkflowFromTemplate(
  templateId: string,
  body: { id: string; displayName?: string }
): Promise<{ id: string }> {
  return postJson(`/designer/templates/${encodeURIComponent(templateId)}/create-workflow`, body);
}

export function getDesignerWorkflows(): Promise<DesignerWorkflowSummary[]> {
  return fetchJson<DesignerWorkflowSummary[]>("/designer/workflows");
}

export function getDesignerWorkflow(id: string): Promise<DesignerStoredWorkflow> {
  return fetchJson<DesignerStoredWorkflow>(`/designer/workflows/${encodeURIComponent(id)}`);
}

export async function createDesignerWorkflow(payload: DesignerStoredWorkflow): Promise<void> {
  await postJson("/designer/workflows", payload);
}

export async function updateDesignerWorkflow(id: string, payload: DesignerStoredWorkflow): Promise<void> {
  await putJson(`/designer/workflows/${encodeURIComponent(id)}`, payload);
}

export function postDesignerTestRun(
  id: string,
  body?: { input?: unknown }
): Promise<{ workflowId: string; runId: string; version: number }> {
  return postJson(`/designer/workflows/${encodeURIComponent(id)}/test-run`, body ?? {});
}

export function getDesignerKinds(): Promise<DesignerKind[]> {
  return fetchJson<DesignerKind[]>("/designer/kinds");
}

export function getActivitiesCatalog(): Promise<ActivityCatalogItem[]> {
  return fetchJson<{ items?: ActivityCatalogItem[] } | ActivityCatalogItem[]>("/activities").then((res) =>
    "items" in res && Array.isArray(res.items) ? res.items : (res as ActivityCatalogItem[])
  );
}

export function getIntegrationsStatus(): Promise<IntegrationStatusItem[]> {
  return fetchJson<{ items?: IntegrationStatusItem[] } | IntegrationStatusItem[]>("/integrations/status").then((res) =>
    "items" in res && Array.isArray(res.items) ? res.items : (res as IntegrationStatusItem[])
  );
}