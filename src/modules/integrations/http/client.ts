import { assertPublicHttpUrl } from "./url-policy";
import type { HttpRequestInput, HttpRequestResult } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

function normalizeHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export interface ExecuteHttpRequestOptions {
  allowPrivateUrls?: boolean;
  maxResponseBodyBytes?: number;
  requireOk?: boolean;
}

export async function executeHttpRequest(
  input: HttpRequestInput,
  options: ExecuteHttpRequestOptions = {}
): Promise<HttpRequestResult> {
  const allowPrivate = Boolean(options.allowPrivateUrls);
  const maxBodyBytes =
    typeof options.maxResponseBodyBytes === "number"
      ? options.maxResponseBodyBytes
      : DEFAULT_MAX_BODY_BYTES;
  const requireOk = Boolean(options.requireOk);

  const url = assertPublicHttpUrl(input.url, allowPrivate);
  const method =
    input.method ??
    (input.body !== undefined && input.body !== null ? "POST" : "GET");

  if ((method === "GET" || method === "HEAD") && input.body !== undefined && input.body !== null) {
    throw new Error("GET/HEAD no admiten body; usa POST o elimina body");
  }

  let body: string | undefined;
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (input.body !== undefined && input.body !== null) {
    if (typeof input.body === "string") {
      body = input.body;
    } else {
      body = JSON.stringify(input.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: controller.signal,
      redirect: "follow",
    });

    if (requireOk && !res.ok) {
      throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }

    const resHeaders = normalizeHeaders(res.headers);
    const contentType = resHeaders["content-type"] ?? resHeaders["Content-Type"] ?? "";
    const buf = await res.arrayBuffer();
    let truncated = false;
    let slice = buf;
    if (buf.byteLength > maxBodyBytes) {
      truncated = true;
      slice = buf.slice(0, maxBodyBytes);
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    let bodyJson: unknown | undefined;
    const looksJson = contentType.includes("json") || /^\s*[\[{]/.test(text);
    if (looksJson && text.length > 0) {
      try {
        bodyJson = JSON.parse(text) as unknown;
      } catch {
        /* ignore */
      }
    }

    return {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      bodyText: text,
      ...(bodyJson !== undefined ? { bodyJson } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
