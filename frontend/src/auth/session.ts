import { API_BASE_URL, clearAccessToken, setAccessToken } from "../config";
import { getAccessToken } from "../config";
import type { IntegrationStatusItem } from "../api/types";

const INTEGRATIONS_STATUS_KEY = "ftn.integrationsStatus";

export type AuthStatus = {
  loginConfigured: boolean;
  authRequired: boolean;
  registrationEnabled?: boolean;
};

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE_URL}/auth/status`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`No se pudo consultar /auth/status (${res.status}): ${text}`);
  }
  return res.json() as Promise<AuthStatus>;
}

function applyAccessTokenFromResponseBody(text: string): IntegrationStatusItem[] | undefined {
  let parsed: { access_token?: string; integrations_status?: IntegrationStatusItem[] };
  try {
    parsed = JSON.parse(text) as { access_token?: string; integrations_status?: IntegrationStatusItem[] };
  } catch {
    throw new Error("Respuesta inválida");
  }
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error("Respuesta sin access_token");
  }
  setAccessToken(parsed.access_token);
  if (Array.isArray(parsed.integrations_status)) {
    sessionStorage.setItem(INTEGRATIONS_STATUS_KEY, JSON.stringify(parsed.integrations_status));
    return parsed.integrations_status;
  }
  sessionStorage.removeItem(INTEGRATIONS_STATUS_KEY);
  return undefined;
}

export function getStoredIntegrationsStatus(): IntegrationStatusItem[] {
  const raw = sessionStorage.getItem(INTEGRATIONS_STATUS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IntegrationStatusItem[]) : [];
  } catch {
    return [];
  }
}

export async function loginWithPassword(username: string, password: string): Promise<IntegrationStatusItem[]> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let message = text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error) {
        message = j.error;
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return applyAccessTokenFromResponseBody(text) ?? [];
}

export async function registerUser(username: string, password: string): Promise<IntegrationStatusItem[]> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let message = text || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string; detail?: string };
      if (typeof j.error === "string" && j.error) {
        message = j.detail ? `${j.error}: ${j.detail}` : j.error;
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return applyAccessTokenFromResponseBody(text) ?? [];
}

export function logout(): void {
  clearAccessToken();
  sessionStorage.removeItem(INTEGRATIONS_STATUS_KEY);
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

export function getCurrentSessionSubject(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = decodeBase64Url(parts[1] ?? "");
    const parsed = JSON.parse(json) as { sub?: unknown };
    return typeof parsed.sub === "string" && parsed.sub.trim() ? parsed.sub.trim() : null;
  } catch {
    return null;
  }
}
