import { API_BASE_URL, authHeaders, clearAccessToken, getAccessToken } from "../config";

const UNAUTH_EVENT = "ftn:auth-unauthorized";

export function notifyAuthFailure(res: Response): void {
  if (res.status !== 401) {
    return;
  }
  if (getAccessToken()) {
    clearAccessToken();
  }
  window.dispatchEvent(new CustomEvent(UNAUTH_EVENT));
}

export function onUnauthorized(listener: () => void): () => void {
  const handler = (): void => listener();
  window.addEventListener(UNAUTH_EVENT, handler);
  return () => window.removeEventListener(UNAUTH_EVENT, handler);
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  notifyAuthFailure(res);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP error! status: ${res.status}, message: ${res.statusText} - ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  notifyAuthFailure(res);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP error! status: ${res.status}, message: ${res.statusText} - ${text}`);
  }
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  notifyAuthFailure(res);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP error! status: ${res.status}, message: ${res.statusText} - ${text}`);
  }
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
