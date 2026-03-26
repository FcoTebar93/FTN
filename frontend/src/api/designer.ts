import { API_BASE_URL, authHeaders } from "../config";
import type { DesignerKind, ActivityCatalogItem } from "./types";
import type { DesignerWorkflowSummary, DesignerStoredWorkflow } from "./types";

export function getDesignerWorkflows(): Promise<DesignerWorkflowSummary[]> {
  return fetch(`${API_BASE_URL}/designer/workflows`, { headers: authHeaders() }).then((r) => r.json());
}

export function getDesignerWorkflow(id: string): Promise<DesignerStoredWorkflow> {
  return fetch(`${API_BASE_URL}/designer/workflows/${encodeURIComponent(id)}`, { headers: authHeaders() }).then((r) => r.json());
}

export async function createDesignerWorkflow(payload: DesignerStoredWorkflow): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/designer/workflows`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Error creando workflow: ${res.status} ${res.statusText} ${text}`);
  }
}

export async function updateDesignerWorkflow(id: string, payload: DesignerStoredWorkflow): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/designer/workflows/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Error actualizando workflow: ${res.status} ${res.statusText} ${text}`);
  }
}

export function getDesignerKinds(): Promise<DesignerKind[]> {
  return fetch(`${API_BASE_URL}/designer/kinds`, { headers: authHeaders() }).then((r) => r.json());
}

export function getActivitiesCatalog(): Promise<ActivityCatalogItem[]> {
  return fetch(`${API_BASE_URL}/activities`, { headers: authHeaders() }).then((r) => r.json())
    .then((res) => ("items" in res ? res.items : res)); // por si devuelves { items, total, ... }
}