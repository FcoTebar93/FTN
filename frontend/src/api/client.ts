import { API_BASE_URL, authHeaders } from "../config";

export async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });

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
  
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP error! status: ${res.status}, message: ${res.statusText} - ${text}`);
    }
    return res.json() as Promise<T>;
  }