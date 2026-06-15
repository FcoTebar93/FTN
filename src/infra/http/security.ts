import { timingSafeEqual } from "node:crypto";
import type http from "node:http";

export interface ApiSecurityConfig {
  corsOrigins: string[];
  apiKey?: string;
  jwtSecret?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  enableRbac: boolean;
  apiKeyScopes: string[];
  loginUsername: string;
  loginPassword?: string;
  registrationEnabled: boolean;
  jwtTtlSeconds: number;
  loginScopes: string;
  rateLimitPerMinute: number;
  maxBodyBytes: number;
  trustProxy: boolean;
}

export function loadApiSecurityConfigFromEnv(env: NodeJS.ProcessEnv): ApiSecurityConfig {
  const corsRaw = env.FTN_CORS_ORIGINS ?? "http://localhost:5173";
  const corsOrigins = corsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const apiKey = env.FTN_API_KEY?.trim() || undefined;
  const jwtSecret = env.FTN_JWT_SECRET?.trim() || undefined;
  const jwtIssuer = env.FTN_JWT_ISSUER?.trim() || undefined;
  const jwtAudience = env.FTN_JWT_AUDIENCE?.trim() || undefined;
  const enableRbac = env.FTN_ENABLE_RBAC === "true" || env.FTN_ENABLE_RBAC === "1";
  const apiKeyScopesRaw = env.FTN_API_KEY_SCOPES?.trim();
  const apiKeyScopes = apiKeyScopesRaw
    ? apiKeyScopesRaw.split(/[\s,]+/).filter(Boolean)
    : ["*"];

  const loginUsername = env.FTN_AUTH_LOGIN_USERNAME?.trim() || "ftn";
  const loginPassword = env.FTN_AUTH_LOGIN_PASSWORD?.trim() || undefined;
  const registrationEnabled =
    env.FTN_AUTH_REGISTRATION_ENABLED === "true" || env.FTN_AUTH_REGISTRATION_ENABLED === "1";
  const jwtTtlSeconds = Math.max(60, parseInt(env.FTN_JWT_TTL_SECONDS ?? "3600", 10) || 3600);
  const loginScopes = env.FTN_AUTH_LOGIN_SCOPES?.trim() || "*";

  const rateLimitPerMinute = Math.max(0, parseInt(env.FTN_HTTP_RATE_LIMIT_PER_MINUTE ?? "300", 10) || 0);
  const maxBodyBytes = Math.max(1024, parseInt(env.FTN_HTTP_MAX_BODY_BYTES ?? String(1024 * 1024), 10) || 1024 * 1024);
  const trustProxy = env.FTN_TRUST_PROXY === "true" || env.FTN_TRUST_PROXY === "1";

  return {
    corsOrigins,
    apiKey,
    jwtSecret,
    jwtIssuer,
    jwtAudience,
    enableRbac,
    apiKeyScopes,
    loginUsername,
    loginPassword,
    registrationEnabled,
    jwtTtlSeconds,
    loginScopes,
    rateLimitPerMinute,
    maxBodyBytes,
    trustProxy,
  };
}

export function isPublicPath(method: string, pathWithoutQuery: string): boolean {
  if (
    method === "GET" &&
    (pathWithoutQuery === "/health" || pathWithoutQuery === "/ready" || pathWithoutQuery === "/health/deps")
  ) {
    return true;
  }
  if (method === "POST" && pathWithoutQuery === "/stripe/webhook") {
    return true;
  }
  if (method === "POST" && pathWithoutQuery === "/auth/login") {
    return true;
  }
  if (method === "GET" && pathWithoutQuery === "/auth/status") {
    return true;
  }
  if (method === "POST" && pathWithoutQuery === "/auth/register") {
    return true;
  }
  if (method === "POST" && pathWithoutQuery === "/auth/refresh") {
    return true;
  }
  if (method === "GET" && pathWithoutQuery === "/integrations/google-sheets/oauth/callback") {
    return true;
  }
  // Checkout público: enlace /pagar del email (workflowId + runId en metadata) sin sesión FTN.
  if (method === "POST" && pathWithoutQuery === "/pay/checkout") {
    return true;
  }
  if (method === "GET" && pathWithoutQuery === "/metrics") {
    return true;
  }
  if (method === "GET" && pathWithoutQuery === "/openapi.json") {
    return true;
  }
  if (method === "GET" && (pathWithoutQuery === "/docs" || pathWithoutQuery === "/swagger")) {
    return true;
  }
  return false;
}

export function applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse, corsOrigins: string[]): string | null {
  const origin = req.headers.origin;
  if (origin && (corsOrigins.includes("*") || corsOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    return origin;
  }
  return null;
}

export function getClientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress || "unknown";
}

export function createRateLimiter(limitPerMinute: number) {
  const bucket = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    if (limitPerMinute <= 0) return true;
    const now = Date.now();
    const curr = bucket.get(key);
    if (!curr || curr.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (curr.count >= limitPerMinute) return false;
    curr.count += 1;
    return true;
  };
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(aa, bb);
}

export function extractBearerOrApiKey(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string") {
    return xApiKey.trim();
  }
  return null;
}

export async function readBodyCapped(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBodyBytes: number
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > maxBodyBytes) {
      res.statusCode = 413;
      res.end("Payload too large");
      return null;
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function isApiKeyValid(rawToken: string, configuredApiKey: string | undefined): boolean {
  if (!configuredApiKey) return false;
  return timingSafeEqualString(rawToken, configuredApiKey);
}
