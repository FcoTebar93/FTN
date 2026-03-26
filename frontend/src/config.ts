export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "http://localhost:4000";

export function authHeaders(extra?: Record<string, string>): HeadersInit {
  const key = import.meta.env.VITE_FTN_API_KEY as string | undefined;
  const headers: Record<string, string> = { ...extra };
  if (key?.trim()) {
    headers.Authorization = `Bearer ${key.trim()}`;
  }
  return headers;
}