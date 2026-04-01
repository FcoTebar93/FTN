import { fetchJson, putJson } from "./client";
import type { CredentialDetail, CredentialSummary, IntegrationStatusItem } from "./types";

export function listCredentials(): Promise<CredentialSummary[]> {
  return fetchJson<CredentialSummary[]>("/credentials");
}

export function getCredential(provider: string): Promise<CredentialDetail> {
  return fetchJson<CredentialDetail>(`/credentials/${encodeURIComponent(provider)}`);
}

export async function saveCredential(
  provider: string,
  payload: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }
): Promise<CredentialSummary> {
  return putJson<CredentialSummary>(`/credentials/${encodeURIComponent(provider)}`, payload);
}

export function getIntegrationsStatus(): Promise<IntegrationStatusItem[]> {
  return fetchJson<{ items?: IntegrationStatusItem[] } | IntegrationStatusItem[]>("/integrations/status").then((res) =>
    "items" in res && Array.isArray(res.items) ? res.items : (res as IntegrationStatusItem[])
  );
}
