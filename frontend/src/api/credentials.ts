import { fetchJson, putJson } from "./client";
import type { CredentialDetail, CredentialSummary } from "./types";

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
