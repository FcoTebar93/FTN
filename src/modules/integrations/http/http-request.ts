import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { HttpConfig, HttpRequestInput, HttpRequestResult } from "./types";
import { assertPublicHttpUrl } from "./url-policy";

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

export function httpRequestActivityDefinition(config: HttpConfig): ActivityDefinition<HttpRequestInput, HttpRequestResult> {
  const allowPrivate = Boolean(config.allowPrivateUrls);
  const maxBodyBytes = typeof config.maxResponseBodyBytes === "number" ? config.maxResponseBodyBytes : DEFAULT_MAX_BODY_BYTES;

  return {
    name: "http.request:v1",
    maxAttempts: 3,
    timeoutMs: MAX_TIMEOUT_MS + 5_000,
    tags: ["http", "integration", "workflow"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "URL http(s) de destino" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
          description: "Por defecto GET si no hay body; si hay body, POST",
        },
        headers: {
          type: "object",
          additionalProperties: true,
          description: "Cabeceras HTTP (claves y valores string)",
        },
        body: { description: "Texto o JSON (objeto/array) para el cuerpo" },
        timeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, description: "Timeout de la petición (ms)" },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: "object",
      required: ["status", "headers"],
      properties: {
        status: { type: "integer" },
        statusText: { type: "string" },
        headers: { type: "object", additionalProperties: true },
        bodyText: { type: "string" },
        bodyJson: {},
        truncated: { type: "boolean" },
      },
      additionalProperties: false,
    },

    async execute(input: HttpRequestInput, ctx: ActivityExecutionContext): Promise<HttpRequestResult> {
      const url = assertPublicHttpUrl(input.url, allowPrivate);
      const method =
        input.method ??
        (input.body !== undefined && input.body !== null ? "POST" : "GET");

      if (method === "GET" || method === "HEAD") {
        if (input.body !== undefined && input.body !== null) {
          throw new Error("GET/HEAD no admiten body; usa POST o elimina body");
        }
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

      const timeout = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      );

      ctx.log("http.request", { url: url.toString(), method, timeoutMs: timeout });

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

        const resHeaders = normalizeHeaders(res.headers);
        const ct = resHeaders["content-type"] ?? resHeaders["Content-Type"] ?? "";
        const buf = await res.arrayBuffer();
        let truncated = false;
        let slice = buf;
        if (buf.byteLength > maxBodyBytes) {
          truncated = true;
          slice = buf.slice(0, maxBodyBytes);
        }

        const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
        let bodyJson: unknown | undefined;
        const looksJson = ct.includes("json") || /^\s*[\[{]/.test(text);
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
    },
  };
}