import { API_BASE_URL, clearAccessToken, setAccessToken } from "../config";
import { getAccessToken } from "../config";

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

function applyAccessTokenFromResponseBody(text: string): void {
  let parsed: { access_token?: string };
  try {
    parsed = JSON.parse(text) as { access_token?: string };
  } catch {
    throw new Error("Respuesta inválida");
  }
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error("Respuesta sin access_token");
  }
  setAccessToken(parsed.access_token);
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
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
  applyAccessTokenFromResponseBody(text);
}

export async function registerUser(username: string, password: string): Promise<void> {
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
  applyAccessTokenFromResponseBody(text);
}

export function logout(): void {
  clearAccessToken();
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
