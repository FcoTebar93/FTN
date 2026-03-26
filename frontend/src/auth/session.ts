import { API_BASE_URL, clearAccessToken, setAccessToken } from "../config";

export type AuthStatus = {
  loginConfigured: boolean;
  authRequired: boolean;
};

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE_URL}/auth/status`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`No se pudo consultar /auth/status (${res.status}): ${text}`);
  }
  return res.json() as Promise<AuthStatus>;
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
      /* usar texto crudo */
    }
    throw new Error(message);
  }
  let parsed: { access_token?: string };
  try {
    parsed = JSON.parse(text) as { access_token?: string };
  } catch {
    throw new Error("Respuesta de login inválida");
  }
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error("Respuesta de login sin access_token");
  }
  setAccessToken(parsed.access_token);
}

export function logout(): void {
  clearAccessToken();
}
