import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type http from "node:http";

import type { ApiSecurityConfig } from "./security";
import { extractBearerOrApiKey, isPublicPath } from "./security";
import { getPathname } from "./url";

export const FTN_SCOPES = {
  catalogRead: "catalog:read",
  designerRead: "designer:read",
  designerWrite: "designer:write",
  credentialsRead: "credentials:read",
  credentialsWrite: "credentials:write",
  workflowsRead: "workflows:read",
  workflowsWrite: "workflows:write",
  paymentsWrite: "payments:write",
} as const;

export interface AuthPrincipal {
  kind: "api_key" | "jwt";
  subject?: string;
  scopes: Set<string>;
  jti?: string;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function isJwtShape(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  scope?: string;
  ftn_scopes?: string[];
  jti?: string;
}

function parseJwtPayload(raw: string): JwtPayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export function verifyJwtHs256(
  token: string,
  secret: string,
  options?: { issuer?: string; audience?: string }
): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [h64, p64, sig64] = parts;
  let headerJson: { alg?: string };
  try {
    headerJson = JSON.parse(Buffer.from(h64!, "base64url").toString("utf8")) as { alg?: string };
  } catch {
    return null;
  }
  if (headerJson.alg !== "HS256") {
    return null;
  }

  const data = `${h64}.${p64}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  let sig: Buffer;
  try {
    sig = Buffer.from(sig64!, "base64url");
  } catch {
    return null;
  }
  if (sig.length !== expected.length) {
    return null;
  }
  if (!timingSafeEqual(sig, expected)) {
    return null;
  }

  const payload = parseJwtPayload(p64!);
  if (!payload) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now >= payload.exp) {
    return null;
  }
  if (typeof payload.nbf === "number" && now < payload.nbf) {
    return null;
  }

  if (options?.issuer && payload.iss !== options.issuer) {
    return null;
  }
  if (options?.audience) {
    const aud = payload.aud;
    const ok =
      aud === options.audience ||
      (Array.isArray(aud) && aud.includes(options.audience));
    if (!ok) {
      return null;
    }
  }

  return payload;
}

export function signJwtHs256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const h64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${h64}.${p64}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function isLoginConfigured(config: ApiSecurityConfig): boolean {
  if (!config.jwtSecret) {
    return false;
  }
  return Boolean(config.loginPassword || config.registrationEnabled);
}

export function validateLoginCredentials(
  config: ApiSecurityConfig,
  username: string,
  password: string
): boolean {
  if (!config.loginPassword || !config.jwtSecret) {
    return false;
  }
  return (
    timingSafeEqualString(username, config.loginUsername) &&
    timingSafeEqualString(password, config.loginPassword)
  );
}

export function issueAccessTokenForSubject(
  config: ApiSecurityConfig,
  subject: string,
  options?: { scopeStrOverride?: string | null }
): { token: string; expiresIn: number; jti: string } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.jwtTtlSeconds;
  const fallback = config.loginScopes.replace(/,/g, " ").trim() || "*";
  const scopeStr = (options?.scopeStrOverride ?? fallback).replace(/,/g, " ").trim() || "*";
  const jti = randomUUID();
  const payload: Record<string, unknown> = {
    sub: subject,
    iat: now,
    exp: now + ttl,
    scope: scopeStr,
    jti,
  };
  if (config.jwtIssuer) {
    payload.iss = config.jwtIssuer;
  }
  if (config.jwtAudience) {
    payload.aud = config.jwtAudience;
  }
  const token = signJwtHs256(payload, config.jwtSecret!);
  return { token, expiresIn: ttl, jti };
}

export function issueAccessToken(config: ApiSecurityConfig): { token: string; expiresIn: number; jti: string } {
  return issueAccessTokenForSubject(config, config.loginUsername);
}

function scopesFromJwtPayload(p: JwtPayload): Set<string> {
  const out = new Set<string>();
  if (typeof p.scope === "string" && p.scope.length > 0) {
    for (const s of p.scope.split(/\s+/)) {
      if (s) out.add(s);
    }
  }
  if (Array.isArray(p.ftn_scopes)) {
    for (const s of p.ftn_scopes) {
      if (typeof s === "string" && s) out.add(s);
    }
  }
  return out;
}

export function isAuthConfigured(config: ApiSecurityConfig): boolean {
  return Boolean(config.apiKey || config.jwtSecret);
}

type AuthAttempt = { kind: "ok"; principal: AuthPrincipal } | { kind: "missing" } | { kind: "invalid" };

function authenticate(req: http.IncomingMessage, config: ApiSecurityConfig): AuthAttempt {
  const raw = extractBearerOrApiKey(req);
  if (!raw) {
    return { kind: "missing" };
  }

  const hasJwt = Boolean(config.jwtSecret);
  const hasKey = Boolean(config.apiKey);

  if (hasJwt && isJwtShape(raw)) {
    const payload = verifyJwtHs256(raw, config.jwtSecret!, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    });
    if (!payload) {
      return { kind: "invalid" };
    }
    let scopes = scopesFromJwtPayload(payload);
    if (scopes.size === 0 && !config.enableRbac) {
      scopes = new Set(["*"]);
    }
    if (scopes.size === 0 && config.enableRbac) {
      return { kind: "invalid" };
    }
    return {
      kind: "ok",
      principal: {
        kind: "jwt",
        subject: typeof payload.sub === "string" ? payload.sub : undefined,
        scopes,
        jti: typeof payload.jti === "string" && payload.jti.length > 0 ? payload.jti : undefined,
      },
    };
  }

  if (hasKey && config.apiKey) {
    if (timingSafeEqualString(raw, config.apiKey)) {
      return {
        kind: "ok",
        principal: {
          kind: "api_key",
          scopes: new Set(config.apiKeyScopes),
        },
      };
    }
    return { kind: "invalid" };
  }

  if (hasJwt && !isJwtShape(raw)) {
    return { kind: "invalid" };
  }

  return { kind: "invalid" };
}

export function authenticatePrincipal(
  req: http.IncomingMessage,
  config: ApiSecurityConfig
): AuthPrincipal | undefined {
  const attempt = authenticate(req, config);
  return attempt.kind === "ok" ? attempt.principal : undefined;
}

export function requiredScopesForRoute(method: string, pathWithoutQuery: string): string[] {
  const p = getPathname(pathWithoutQuery);

  if (method === "GET" && (p === "/activities" || p.startsWith("/activities/"))) {
    return [FTN_SCOPES.catalogRead];
  }
  if (method === "GET" && (p === "/catalog/workflows" || p.startsWith("/catalog/workflows"))) {
    return [FTN_SCOPES.catalogRead];
  }

  if (p.startsWith("/designer")) {
    if (method === "POST" || method === "PUT") {
      return [FTN_SCOPES.designerWrite];
    }
    return [FTN_SCOPES.designerRead];
  }

  if (p.startsWith("/credentials")) {
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      return [FTN_SCOPES.credentialsWrite];
    }
    return [FTN_SCOPES.credentialsRead];
  }

  if (p.startsWith("/workflows")) {
    if (method === "POST" && p.endsWith("/signals")) {
      return [FTN_SCOPES.workflowsWrite];
    }
    if (method === "GET") {
      return [FTN_SCOPES.workflowsRead];
    }
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      return [FTN_SCOPES.workflowsWrite];
    }
    return [FTN_SCOPES.workflowsRead];
  }

  if (method === "POST" && p === "/pay/checkout") {
    return [FTN_SCOPES.paymentsWrite];
  }

  if (method === "POST" && p === "/auth/logout") {
    return [];
  }

  if (method === "GET" && (p === "/audit/logs" || p.startsWith("/audit/logs"))) {
    return [FTN_SCOPES.workflowsRead];
  }

  if (method === "GET" || method === "HEAD") {
    return [FTN_SCOPES.workflowsRead];
  }
  return [FTN_SCOPES.workflowsWrite];
}

function hasAllScopes(granted: Set<string>, required: string[]): boolean {
  if (granted.has("*")) {
    return true;
  }
  return required.every((r) => granted.has(r));
}

export function checkProtectedAccess(
  req: http.IncomingMessage,
  config: ApiSecurityConfig,
  method: string,
  pathWithoutQuery: string
): "allow" | "unauthorized" | "forbidden" {
  if (isPublicPath(method, pathWithoutQuery)) {
    return "allow";
  }
  if (!isAuthConfigured(config)) {
    return "allow";
  }

  const attempt = authenticate(req, config);
  if (attempt.kind === "missing" || attempt.kind === "invalid") {
    return "unauthorized";
  }

  if (!config.enableRbac) {
    return "allow";
  }

  const required = requiredScopesForRoute(method, pathWithoutQuery);
  if (required.length === 0) {
    return "allow";
  }

  if (hasAllScopes(attempt.principal.scopes, required)) {
    return "allow";
  }
  return "forbidden";
}
