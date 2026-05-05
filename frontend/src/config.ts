export const FTN_ACCESS_TOKEN_KEY = "ftn_access_token";

function defaultApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:4000`;
  }
  return "http://localhost:4000";
}

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || defaultApiBaseUrl();

export function getAccessToken(): string | null {
  try {
    return sessionStorage.getItem(FTN_ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(FTN_ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  try {
    sessionStorage.removeItem(FTN_ACCESS_TOKEN_KEY);
  } catch {
    console.error("Failed to clear access token from session storage");
  }
}

export function authHeaders(extra?: Record<string, string>): HeadersInit {
  const key = import.meta.env.VITE_FTN_API_KEY as string | undefined;
  const headers: Record<string, string> = { ...extra };
  const sessionToken = getAccessToken();
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  } else if (key?.trim()) {
    headers.Authorization = `Bearer ${key.trim()}`;
  }
  return headers;
}