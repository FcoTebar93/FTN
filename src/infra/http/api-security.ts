import { timingSafeEqual } from "node:crypto";
import type http from "node:http";

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}

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
  jwtTtlSeconds: number;
  loginScopes: string;
  rateLimitPerMinute: number;
  maxBodyBytes: number;
  trustProxy: boolean;
}

export function loadApiSecurityConfigFromEnv(): ApiSecurityConfig {
  const corsRaw = process.env.FTN_CORS_ORIGINS ?? "http://localhost:5173";
  const corsOrigins = corsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const apiKey = process.env.FTN_API_KEY?.trim() || undefined;
  const jwtSecret = process.env.FTN_JWT_SECRET?.trim() || undefined;
  const jwtIssuer = process.env.FTN_JWT_ISSUER?.trim() || undefined;
  const jwtAudience = process.env.FTN_JWT_AUDIENCE?.trim() || undefined;
  const enableRbac = process.env.FTN_ENABLE_RBAC === "true" || process.env.FTN_ENABLE_RBAC === "1";
  const apiKeyScopesRaw = process.env.FTN_API_KEY_SCOPES?.trim();
  const apiKeyScopes = apiKeyScopesRaw
    ? apiKeyScopesRaw.split(/[\s,]+/).filter(Boolean)
    : ["*"];

  const loginUsername = process.env.FTN_AUTH_LOGIN_USERNAME?.trim() || "ftn";
  const loginPassword = process.env.FTN_AUTH_LOGIN_PASSWORD?.trim() || undefined;
  const jwtTtlSeconds = Math.max(60, parseInt(process.env.FTN_JWT_TTL_SECONDS ?? "3600", 10) || 3600);
  const loginScopes = process.env.FTN_AUTH_LOGIN_SCOPES?.trim() || "*";

  const rateLimitPerMinute = Math.max(0, parseInt(process.env.FTN_HTTP_RATE_LIMIT_PER_MINUTE ?? "300", 10) || 0);
  const maxBodyBytes = Math.max(1024, parseInt(process.env.FTN_HTTP_MAX_BODY_BYTES ?? String(1024 * 1024), 10) || 1024 * 1024);
  const trustProxy = process.env.FTN_TRUST_PROXY === "true" || process.env.FTN_TRUST_PROXY === "1";

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
    jwtTtlSeconds,
    loginScopes,
    rateLimitPerMinute,
    maxBodyBytes,
    trustProxy,
  };
}

export function isPublicPath(method: string, pathWithoutQuery: string): boolean {
  if (method === "GET" && (pathWithoutQuery === "/health" || pathWithoutQuery === "/ready")) {
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
  return false;
}

export function getClientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0]!.trim();
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function extractBearerOrApiKey(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const xk = req.headers["x-api-key"];
  if (typeof xk === "string" && xk.length > 0) {
    return xk.trim();
  }
  if (Array.isArray(xk) && xk[0]) {
    return xk[0].trim();
  }
  return undefined;
}

export function isAuthorized(req: http.IncomingMessage, expectedKey: string | undefined): boolean {
  if (!expectedKey) {
    return true;
  }
  const got = extractBearerOrApiKey(req);
  if (!got) {
    return false;
  }
  return timingSafeEqualString(got, expectedKey);
}

export function applyCorsHeaders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  corsOrigins: string[]
): void {
  const origin = req.headers.origin;
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (corsOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, X-Request-Id"
  );
}

type Window = { count: number; resetAt: number };

export function createRateLimiter(perMinute: number): (ip: string) => boolean {
  if (perMinute <= 0) {
    return () => true;
  }
  const windows = new Map<string, Window>();
  const windowMs = 60_000;
  const max = perMinute;

  return (ip: string): boolean => {
    const now = Date.now();
    let w = windows.get(ip);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(ip, w);
    }
    w.count += 1;
    if (w.count > max) {
      return false;
    }
    return true;
  };
}

export function readLimitedBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

/** Lee el cuerpo; si supera el límite responde 413 y devuelve `null`. */
export async function readBodyCapped(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number
): Promise<string | null> {
  try {
    return await readLimitedBody(req, maxBytes);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Payload too large" }));
      return null;
    }
    throw e;
  }
}
