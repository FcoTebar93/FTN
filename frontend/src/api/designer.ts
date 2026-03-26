import { fetchJson, postJson, putJson } from "./client";
import type { DesignerKind, ActivityCatalogItem } from "./types";
import type { DesignerWorkflowSummary, DesignerStoredWorkflow } from "./types";

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

export function getDesignerKinds(): Promise<DesignerKind[]> {
  return fetchJson<DesignerKind[]>("/designer/kinds");
}

export function getActivitiesCatalog(): Promise<ActivityCatalogItem[]> {
  return fetchJson<{ items?: ActivityCatalogItem[] } | ActivityCatalogItem[]>("/activities").then((res) =>
    "items" in res && Array.isArray(res.items) ? res.items : (res as ActivityCatalogItem[])
  );
}