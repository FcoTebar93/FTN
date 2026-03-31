import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import { executeHttpRequest } from "./client";
import type { HttpConfig, HttpRequestInput, HttpRequestResult } from "./types";

const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

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
      const method =
        input.method ??
        (input.body !== undefined && input.body !== null ? "POST" : "GET");
      const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1, input.timeoutMs ?? 15_000));
      ctx.log("http.request", { url: input.url, method, timeoutMs: timeout });

      return executeHttpRequest(
        { ...input, method, timeoutMs: timeout },
        { allowPrivateUrls: allowPrivate, maxResponseBodyBytes: maxBodyBytes, requireOk: false }
      );
    },
  };
}