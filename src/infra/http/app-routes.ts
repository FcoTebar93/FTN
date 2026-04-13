import type http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";

import type { WorkflowTask } from "../../shared/tasks";
import { getWorkflow, getWorkflowDescriptor } from "../../app/workflows";
import { matchHttpTrigger } from "../../app/triggers";
import { readBodyCapped, extractBearerOrApiKey, type ApiSecurityConfig } from "./security";
import {
  isAuthConfigured,
  isLoginConfigured,
  issueAccessToken,
  issueAccessTokenForSubject,
  validateLoginCredentials,
  verifyJwtHs256,
} from "./auth";
import { normalizeAndValidateUsername, validatePlainPassword } from "./registration";
import { hashPassword, verifyPassword } from "../passwords";
import {
  consumeRefreshToken,
  deleteRefreshTokensForUser,
  getUserPasswordHash,
  getUserScopesText,
  insertAuditLog,
  insertUser,
  newRefreshTokenRaw,
  revokeAccessTokenJti,
  storeRefreshToken,
} from "../users";
import { validateJson } from "../../shared/json-schema-validate";
import type { StoredWorkflow } from "../../app/designer-types";
import {
  getDesignerRuntimeName,
  getStoredWorkflow,
  listStoredWorkflows,
  upsertStoredWorkflow,
} from "../../app/designer-store";
import { normalizeStoredWorkflow, validateSchedule } from "../../app/designer-schedule";
import { validateDesignerWorkflow } from "../../app/designer-validate";
import { getCredential, listCredentials, upsertCredential } from "../../app/credentials";
import { DESIGNER_KINDS } from "../../app/designer-kinds";
import { SWAGGER_UI_HTML } from "../swagger-ui";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { InMemoryActivityRegistry } from "../../modules/activity-registry/inmemory-activity-registry";
import type { InMemoryWorkflowRuntime } from "../inmemory-workflow-runtime";
import type { EventStore } from "../../modules/event-store";
import type { TaskQueue } from "../../modules/task-queue";

export interface FtnAppRouteContext {
  pool: Pool | undefined;
  apiSecurity: ApiSecurityConfig;
  hasDbLogin: boolean;
  refreshTtlSeconds: number;
  requestSubject: string;
  activities: InMemoryActivityRegistry;
  runtime: InMemoryWorkflowRuntime;
  eventStore: EventStore;
  taskQueue: TaskQueue;
  redis: Redis | undefined;
  enqueueWorkflowStart: (
    name: string,
    input: unknown
  ) => Promise<{ workflowId: string; runId: string; version: number }>;
  getIntegrationsStatusForSubject: (subject: string) => Promise<
    Array<{
      key: string;
      label: string;
      configured: boolean;
      source: "credentials" | "env" | "none";
      details?: string;
    }>
  >;
  requestId: string;
}

export async function handleAppRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }

    const rawPath = req.url.split("?")[0] ?? "";

    if (req.method === "POST" && rawPath === "/auth/login") {
      if (!isLoginConfigured(ctx.apiSecurity) && !ctx.hasDbLogin) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;

      let parsed: { username?: unknown; password?: unknown };
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const u = typeof parsed.username === "string" ? parsed.username : "";
      const p = typeof parsed.password === "string" ? parsed.password : "";

      let token: string;
      let expiresIn: number;
      let subjectForAudit: string | undefined;

      if (validateLoginCredentials(ctx.apiSecurity, u, p)) {
        ({ token, expiresIn } = issueAccessToken(ctx.apiSecurity));
        subjectForAudit = ctx.apiSecurity.loginUsername;
      } else if (ctx.pool && ctx.apiSecurity.jwtSecret) {
        const normalized = normalizeAndValidateUsername(u);
        if (!normalized) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid credentials" }));
          return;
        }
        const storedHash = await getUserPasswordHash(ctx.pool, normalized);
        if (!storedHash || !(await verifyPassword(p, storedHash))) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid credentials" }));
          return;
        }
        const scopeFromDb = await getUserScopesText(ctx.pool, normalized);
        ({ token, expiresIn } = issueAccessTokenForSubject(ctx.apiSecurity, normalized, { scopeStrOverride: scopeFromDb }));
        subjectForAudit = normalized;
      } else {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return;
      }

      const bodyOut: Record<string, unknown> = {
        access_token: token,
        token_type: "Bearer",
        expires_in: expiresIn,
      };
      if (ctx.pool && ctx.apiSecurity.jwtSecret && subjectForAudit) {
        const refreshRaw = newRefreshTokenRaw();
        const refreshExpiresAt = new Date(Date.now() + ctx.refreshTtlSeconds * 1000);
        await storeRefreshToken(ctx.pool, subjectForAudit, refreshRaw, refreshExpiresAt);
        bodyOut.refresh_token = refreshRaw;
        bodyOut.refresh_expires_in = ctx.refreshTtlSeconds;
      }
      await insertAuditLog(ctx.pool, {
        subject: subjectForAudit ?? "api_user",
        action: "login",
        detail: { source: "password" },
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(bodyOut));
      return;
    }

    if (req.method === "POST" && rawPath === "/auth/register") {
      if (!ctx.pool || !ctx.apiSecurity.registrationEnabled || !ctx.apiSecurity.jwtSecret) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Registration is not available" }));
        return;
      }

      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;

      let parsed: { username?: unknown; password?: unknown };
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const rawUser = typeof parsed.username === "string" ? parsed.username : "";
      const rawPass = typeof parsed.password === "string" ? parsed.password : "";
      const normalized = normalizeAndValidateUsername(rawUser);
      if (!normalized || !validatePlainPassword(rawPass)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: "Invalid username or password",
            detail:
              "Usuario: 3–64 caracteres (letras, números, _, ., -). Contraseña: mínimo 10 caracteres.",
          })
        );
        return;
      }

      const passwordHash = await hashPassword(rawPass);
      const inserted = await insertUser(ctx.pool, normalized, passwordHash);
      if (inserted === "duplicate") {
        res.statusCode = 409;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Username already taken" }));
        return;
      }

      const { token, expiresIn } = issueAccessTokenForSubject(ctx.apiSecurity, normalized);
      const bodyReg: Record<string, unknown> = {
        access_token: token,
        token_type: "Bearer",
        expires_in: expiresIn,
      };
      if (ctx.apiSecurity.jwtSecret) {
        const refreshRaw = newRefreshTokenRaw();
        const refreshExpiresAt = new Date(Date.now() + ctx.refreshTtlSeconds * 1000);
        await storeRefreshToken(ctx.pool, normalized, refreshRaw, refreshExpiresAt);
        bodyReg.refresh_token = refreshRaw;
        bodyReg.refresh_expires_in = ctx.refreshTtlSeconds;
      }
      await insertAuditLog(ctx.pool, {
        subject: normalized,
        action: "register",
      });
      res.statusCode = 201;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(bodyReg));
      return;
    }

    if (req.method === "POST" && rawPath === "/auth/refresh") {
      if (!ctx.pool || !ctx.apiSecurity.jwtSecret) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Refresh is not available" }));
        return;
      }
      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      let parsed: { refresh_token?: unknown };
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const rt = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
      if (!rt.trim()) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing refresh_token" }));
        return;
      }
      const consumed = await consumeRefreshToken(ctx.pool, rt.trim());
      if (!consumed) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid refresh token" }));
        return;
      }
      const scopeFromDb = await getUserScopesText(ctx.pool, consumed.username);
      const issued = issueAccessTokenForSubject(ctx.apiSecurity, consumed.username, { scopeStrOverride: scopeFromDb });
      const refreshRaw = newRefreshTokenRaw();
      await storeRefreshToken(ctx.pool, consumed.username, refreshRaw, new Date(Date.now() + ctx.refreshTtlSeconds * 1000));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          access_token: issued.token,
          token_type: "Bearer",
          expires_in: issued.expiresIn,
          refresh_token: refreshRaw,
          refresh_expires_in: ctx.refreshTtlSeconds,
        })
      );
      return;
    }

    if (req.method === "POST" && rawPath === "/auth/logout") {
      const rawTok = extractBearerOrApiKey(req);
      if (!rawTok || !ctx.apiSecurity.jwtSecret) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const payload = verifyJwtHs256(rawTok, ctx.apiSecurity.jwtSecret, {
        issuer: ctx.apiSecurity.jwtIssuer,
        audience: ctx.apiSecurity.jwtAudience,
      });
      const jti = typeof payload?.jti === "string" ? payload.jti : undefined;
      if (!jti) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Token cannot be revoked (missing jti)" }));
        return;
      }
      const expSec = typeof payload?.exp === "number" ? payload.exp : Math.floor(Date.now() / 1000) + ctx.apiSecurity.jwtTtlSeconds;
      await revokeAccessTokenJti(ctx.pool, jti, new Date(expSec * 1000));
      const sub = typeof payload?.sub === "string" ? payload.sub : undefined;
      if (ctx.pool && sub) {
        await deleteRefreshTokensForUser(ctx.pool, sub);
      }
      await insertAuditLog(ctx.pool, {
        subject: sub ?? "unknown",
        action: "logout",
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && rawPath === "/audit/logs") {
      if (!ctx.pool) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Audit log requires Postgres" }));
        return;
      }
      const auditUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const lim = Math.min(500, Math.max(1, parseInt(auditUrl.searchParams.get("limit") ?? "50", 10) || 50));
      const r = await ctx.pool.query(
        `SELECT occurred_at, subject, action, resource, detail_json FROM ftn_audit_log ORDER BY occurred_at DESC LIMIT $1`,
        [lim]
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ items: r.rows }));
      return;
    }

    if (req.method === "GET" && rawPath === "/auth/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          loginConfigured: isLoginConfigured(ctx.apiSecurity) || ctx.hasDbLogin,
          authRequired: isAuthConfigured(ctx.apiSecurity),
          registrationEnabled: Boolean(ctx.apiSecurity.registrationEnabled && ctx.pool),
        })
      );
      return;
    }

    if (req.method === "GET" && rawPath === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "GET" && rawPath === "/openapi.json") {
      const specPath = join(process.cwd(), "docs/api/openapi.json");
      if (!existsSync(specPath)) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "OpenAPI spec not found" }));
        return;
      }
      const raw = readFileSync(specPath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.end(raw);
      return;
    }

    if (req.method === "GET" && rawPath === "/docs") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(SWAGGER_UI_HTML);
      return;
    }

    if (req.method === "GET" && rawPath === "/swagger") {
      res.statusCode = 302;
      res.setHeader("Location", "/docs");
      res.end();
      return;
    }

    if (req.method === "GET" && rawPath === "/ready") {
      const checks: { postgres?: boolean; redis?: boolean } = {};
      if (ctx.pool) {
        try {
          await ctx.pool.query("SELECT 1");
          checks.postgres = true;
        } catch {
          checks.postgres = false;
        }
      }
      if (ctx.redis) {
        try {
          await ctx.redis.ping();
          checks.redis = true;
        } catch {
          checks.redis = false;
        }
      }
      const ok =
        (!ctx.pool || checks.postgres === true) &&
        (!ctx.redis || checks.redis === true);
      res.statusCode = ok ? 200 : 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: ok ? "ready" : "not_ready", checks }));
      return;
    }

    if (req.method === "GET" && req.url === "/designer/kinds") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(DESIGNER_KINDS));
      return;
    }

    if (req.method === "GET" && (rawPath === "/integrations/status" || rawPath.startsWith("/integrations/status?"))) {
      const items = await ctx.getIntegrationsStatusForSubject(ctx.requestSubject);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ items }));
      return;
    }

    if (req.method === "GET" && (req.url === "/designer/workflows" || req.url?.startsWith("/designer/workflows?"))) {
      const items = await listStoredWorkflows(ctx.requestSubject);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(items));
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/designer/workflows/")) {
      const pathOnly = req.url.split("?")[0];
      const parts = pathOnly.split("/");
      if (parts.length !== 4) {
        res.statusCode = 400;
        res.end("Expected /designer/workflows/:id");
        return;
      }

      const id = decodeURIComponent(parts[3]);
      const wf = await getStoredWorkflow(ctx.requestSubject, id);
      if (wf === undefined) {
        res.statusCode = 404;
        res.end("Designer workflow not found");
        return;
      }

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(wf));
      return;
    }

    if (req.method === "GET" && (rawPath === "/credentials" || rawPath.startsWith("/credentials?"))) {
      const items = await listCredentials(ctx.requestSubject);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(items));
      return;
    }

    if (req.method === "GET" && rawPath.startsWith("/credentials/")) {
      const parts = rawPath.split("/");
      if (parts.length !== 3 || !parts[2]) {
        res.statusCode = 400;
        res.end("Expected /credentials/:provider");
        return;
      }
      const provider = decodeURIComponent(parts[2]);
      const cred = await getCredential(ctx.requestSubject, provider);
      if (!cred) {
        res.statusCode = 404;
        res.end("Credential not found");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(cred));
      return;
    }

    if (req.method === "PUT" && rawPath.startsWith("/credentials/")) {
      const parts = rawPath.split("/");
      if (parts.length !== 3 || !parts[2]) {
        res.statusCode = 400;
        res.end("Expected /credentials/:provider");
        return;
      }
      const provider = decodeURIComponent(parts[2]);
      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const parsed = JSON.parse(body || "{}") as {
          config?: unknown;
          secrets?: unknown;
        };
        const config =
          parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)
            ? (parsed.config as Record<string, unknown>)
            : undefined;
        const secrets =
          parsed.secrets && typeof parsed.secrets === "object" && !Array.isArray(parsed.secrets)
            ? (parsed.secrets as Record<string, unknown>)
            : undefined;
        if (!config && !secrets) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Payload must include config or secrets object" }));
          return;
        }
        const saved = await upsertCredential(ctx.requestSubject, provider, { config, secrets });
        await insertAuditLog(ctx.pool, {
          subject: ctx.requestSubject,
          action: "credentials.upsert",
          resource: provider,
          detail: { hasConfig: Boolean(config), hasSecrets: Boolean(secrets) },
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(saved));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/designer/workflows") {
      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const parsed = JSON.parse(body || "{}") as StoredWorkflow;

        if (!parsed.id || !parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
          res.statusCode = 400;
          res.end("Invalid StoredWorkflow payload");
          return;
        }

        if ((await getStoredWorkflow(ctx.requestSubject, parsed.id)) !== undefined) {
          res.statusCode = 409;
          res.end(`StoredWorkflow "${parsed.id}" already exists`);
          return;
        }

        const normalized = normalizeStoredWorkflow(parsed);
        const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
        if (schedErr) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: schedErr }));
          return;
        }

        const graphErr = validateDesignerWorkflow(normalized);
        if (graphErr) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: graphErr }));
          return;
        }

        await upsertStoredWorkflow(ctx.requestSubject, normalized);

        if (normalized.schedule?.type === "instant") {
          try {
            await ctx.enqueueWorkflowStart(
              getDesignerRuntimeName(ctx.requestSubject, normalized.id),
              normalized.scheduledInput ?? {}
            );
          } catch (e) {
            res.statusCode = 201;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: true,
                id: normalized.id,
                version: normalized.version,
                instantRunError: String((e as Error).message),
              })
            );
            return;
          }
        }

        res.setHeader("Content-Type", "application/json");
        res.statusCode = 201;
        res.end(JSON.stringify({ ok: true, id: normalized.id, version: normalized.version }));
      } catch (e) {
        res.statusCode = 400;
        res.end(`Invalid JSON: ${(e as Error).message}`);
      }
      return;
    }

    if (req.method === "PUT" && req.url?.startsWith("/designer/workflows/")) {
      const pathOnly = req.url.split("?")[0];
      const parts = pathOnly.split("/");
      if (parts.length !== 4) {
        res.statusCode = 400;
        res.end("Expected /designer/workflows/:id");
        return;
      }

      const id = decodeURIComponent(parts[3]);

      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const parsed = JSON.parse(body || "{}") as StoredWorkflow;

        if (!parsed.version || !parsed.displayName || !parsed.steps || !parsed.entryStepId) {
          res.statusCode = 400;
          res.end("Invalid StoredWorkflow payload");
          return;
        }

        const stored: StoredWorkflow = { ...parsed, id };

        const normalized = normalizeStoredWorkflow(stored);
        const schedErr = validateSchedule(normalized.schedule ?? { type: "instant" });
        if (schedErr) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: schedErr }));
          return;
        }

        const graphErrPut = validateDesignerWorkflow(normalized);
        if (graphErrPut) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: graphErrPut }));
          return;
        }

        await upsertStoredWorkflow(ctx.requestSubject, normalized);

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, id: normalized.id, version: normalized.version }));
      } catch (e) {
        res.statusCode = 400;
        res.end(`Invalid JSON: ${(e as Error).message}`);
      }
      return;
    }

    if (req.method === "POST" && rawPath.startsWith("/designer/workflows/") && rawPath.endsWith("/test-run")) {
      const parts = rawPath.split("/").filter(Boolean);
      if (parts.length !== 4 || parts[0] !== "designer" || parts[1] !== "workflows" || parts[3] !== "test-run") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Expected POST /designer/workflows/:id/test-run" }));
        return;
      }
      const id = decodeURIComponent(parts[2]);
      const wf = await getStoredWorkflow(ctx.requestSubject, id);
      if (wf === undefined) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Designer workflow not found" }));
        return;
      }
      const bodyTr = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (bodyTr === null) return;
      let input: unknown = wf.scheduledInput ?? {};
      try {
        if (bodyTr.trim()) {
          const parsedBody = JSON.parse(bodyTr) as { input?: unknown };
          if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) && "input" in parsedBody) {
            input = parsedBody.input;
          } else {
            input = parsedBody;
          }
        }
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
      try {
        const { workflowId, runId, version } = await ctx.enqueueWorkflowStart(
          getDesignerRuntimeName(ctx.requestSubject, id),
          input
        );
        res.statusCode = 201;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowId, runId, version }));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    if (req.method === "POST" && rawPath === "/workflows") {
      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const parsed = JSON.parse(body || "{}") as { name?: unknown; input?: unknown };
        const name = typeof parsed.name === "string" ? parsed.name : "";
        if (!name) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing name" }));
          return;
        }
        const input = parsed.input;
        const { workflowId, runId, version } = await ctx.enqueueWorkflowStart(name, input);

        res.statusCode = 201;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowId, runId, version }));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    if (req.method === "GET" && (req.url === "/workflows" || req.url.startsWith("/workflows?"))) {
      const [, queryString] = req.url.split("?");
      const params = new URLSearchParams(queryString ?? "");
      const statusFilter = params.get("status") as "running" | "completed" | "failed" | null;
      const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10)));
      const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10));

      const runKeys = await ctx.eventStore.listRunKeys();
      const slice = runKeys.slice(offset, offset + limit);

      const summaries: Array<{
        workflowId: string;
        runId: string;
        name: string;
        status: string;
        startedAt: string | undefined;
        completedAt: string | undefined;
        failedAt: string | undefined;
        failureReason: string | undefined;
      }> = [];

      for (const { workflowId, runId } of slice) {
        const state = await ctx.runtime.loadCurrentState(workflowId, runId);
        if (!state) continue;

        const events = await ctx.eventStore.loadEvents(workflowId, runId, 0);
        const startEvent = events.find((e) => e.type === "WorkflowStarted");
        const name =
          startEvent && startEvent.type === "WorkflowStarted"
            ? startEvent.payload.name
            : "unknown";

        if (statusFilter && state.status !== statusFilter) continue;

        summaries.push({
          workflowId,
          runId,
          name,
          status: state.status,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
          failedAt: state.failedAt,
          failureReason: state.failureReason,
        });
      }

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(summaries));
      return;
    }

    const pathOnlyTrigger = (req.url ?? "").split("?")[0];
    const trigger = matchHttpTrigger(req.method ?? "GET", pathOnlyTrigger);

    if (trigger) {
      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const wfDef = getWorkflow(trigger.workflowName);
        if (!wfDef) {
          res.statusCode = 500;
          res.end(`Workflow "${trigger.workflowName}" not registered`);
          return;
        }

        const descriptor = getWorkflowDescriptor(trigger.workflowName);
        const parsedBody = body ? JSON.parse(body) : undefined;
        const input = trigger.useBodyAsInput ? parsedBody : undefined;

        if (descriptor?.inputSchema) {
          const result = validateJson(descriptor.inputSchema, input);
          if (!result.valid) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid input", details: result.errors }));
            return;
          }
        }

        const { workflowId, runId } = await ctx.runtime.startWorkflow({
          workflowName: trigger.workflowName,
          workflowVersion: descriptor?.version,
          input,
          definition: wfDef,
        });

        const task: WorkflowTask = {
          id: `wf-task-${workflowId}-${runId}`,
          type: "workflow",
          workflowId,
          runId,
          createdAt: new Date().toISOString(),
          scheduledAt: new Date().toISOString(),
          workerType: "workflow",
          targetQueue: "workflows",
        };

        await ctx.taskQueue.enqueue(task);

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ workflowId, runId }));
      } catch (e) {
        res.statusCode = 500;
        res.end(`Error handling trigger: ${(e as Error).message}`);
      }
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/workflows/") && req.url.endsWith("/events")) {
      const parts = req.url.split("?")[0].split("/");
      if (parts.length !== 5) {
        res.statusCode = 400;
        res.end("Expected /workflows/:workflowId/:runId/events");
        return;
      }
      const workflowId = parts[2];
      const runId = parts[3];
      const events = await ctx.eventStore.loadEvents(workflowId, runId, 0);
      if (!events || events.length === 0) {
        res.statusCode = 404;
        res.end("No events found");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(events));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/workflows/") && req.url.endsWith("/steps")) {
      const parts = req.url.split("?")[0].split("/");
      if (parts.length !== 5) {
        res.statusCode = 400;
        res.end("Expected /workflows/:workflowId/:runId/steps");
        return;
      }
      const workflowId = parts[2];
      const runId = parts[3];
      const state = await ctx.runtime.loadCurrentState(workflowId, runId);
      if (!state) {
        res.statusCode = 404;
        res.end("Workflow not found");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(state.steps));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/workflows/")) {
      const pathOnlyWf = req.url.split("?")[0];
      const parts = pathOnlyWf.split("/");
      if (parts.length !== 4) {
        res.statusCode = 400;
        res.end("Expected /workflows/:workflowId/:runId");
        return;
      }
      const workflowId = parts[2];
      const runId = parts[3];
      const state = await ctx.runtime.loadCurrentState(workflowId, runId);
      if (!state) {
        res.statusCode = 404;
        res.end("Workflow not found");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(state));
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/workflows/") && req.url.endsWith("/signals")) {
      const parts = req.url.split("/");
      if (parts.length !== 5) {
        res.statusCode = 400;
        res.end("Expected /workflows/:workflowId/:runId/signals");
        return;
      }
      const workflowId = parts[2];
      const runId = parts[3];

      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const parsed = JSON.parse(body || "{}");
        const { signalName, data } = parsed;

        const state = await ctx.runtime.loadCurrentState(workflowId, runId);
        if (!state) {
          res.statusCode = 404;
          res.end("Workflow not found");
          return;
        }

        await ctx.eventStore.appendEvents(workflowId, runId, state.version, [
          {
            type: "SignalReceived",
            workflowId,
            runId,
            payload: { signalName, data },
          },
        ]);

        const task: WorkflowTask = {
          id: `wf-task-signal-${workflowId}-${runId}-${Date.now()}`,
          type: "workflow",
          workflowId,
          runId,
          createdAt: new Date().toISOString(),
          scheduledAt: new Date().toISOString(),
          workerType: "workflow",
          targetQueue: "workflows",
        };

        await ctx.taskQueue.enqueue(task);

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 500;
        res.end(`Error sending signal: ${(e as Error).message}`);
      }
      return;
    }

    if (req.method === "POST" && req.url === "/pay/checkout") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const { successUrl, cancelUrl, customerEmail, currency, lineItems, metadata } = parsed;

          const key = process.env.STRIPE_SECRET_KEY;
          if (!key) {
            res.statusCode = 500;
            res.end("STRIPE_SECRET_KEY not configured");
            return;
          }

          const stripe = new Stripe(key, { apiVersion: "2024-06-20" as any });
          const session = await stripe.checkout.sessions.create({
            mode: "payment",
            success_url: successUrl,
            cancel_url: cancelUrl,
            customer_email: customerEmail,
            currency,
            line_items: lineItems.map((li: any) => ({
              quantity: li.quantity,
              price_data: {
                currency,
                unit_amount: li.unitAmountCents,
                product_data: { name: li.name },
              },
            })),
            metadata,
          });

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ sessionId: session.id, url: session.url }));
        } catch (e) {
          res.statusCode = 500;
          res.end(`Error creating checkout: ${(e as Error).message}`);
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/stripe/webhook") {
      const sig = req.headers["stripe-signature"];
      const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
      if (body === null) return;
      try {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!webhookSecret || !stripeSecretKey) {
          res.statusCode = 500;
          res.end("Stripe secrets not configured");
          return;
        }

        const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" as any });
        const event = stripe.webhooks.constructEvent(body, sig as string, webhookSecret);

        if (event.type === "checkout.session.completed") {
          const session: any = event.data.object;
          const md = session.metadata || {};
          const workflowId = md.workflowId;
          const runId = md.runId;

          if (workflowId && runId) {
            const state = await ctx.runtime.loadCurrentState(workflowId, runId);
            if (state) {
              await ctx.eventStore.appendEvents(workflowId, runId, state.version, [
                {
                  type: "SignalReceived",
                  workflowId,
                  runId,
                  payload: {
                    signalName: "payment-completed",
                    data: {
                      sessionId: session.id,
                      amountTotal: session.amount_total,
                      currency: session.currency,
                      customerEmail: session.customer_details?.email,
                    },
                  },
                },
              ]);

              const task: WorkflowTask = {
                id: `wf-task-signal-${workflowId}-${runId}-${Date.now()}`,
                type: "workflow",
                workflowId,
                runId,
                createdAt: new Date().toISOString(),
                scheduledAt: new Date().toISOString(),
                workerType: "workflow",
                targetQueue: "workflows",
              };

              await ctx.taskQueue.enqueue(task);
            }
          }
        }

        res.statusCode = 200;
        res.end("[OK] webhook processed");
      } catch (err) {
        res.statusCode = 400;
        res.end(`Webhook error: ${(err as Error).message}`);
      }

      return;
    }

    if (req.method === "GET" && (req.url === "/ctx.activities" || req.url.startsWith("/ctx.activities?"))) {
      const [, queryString] = req.url.split("?");
      const params = new URLSearchParams(queryString ?? "");
      const tag = params.get("tag");
      const module = params.get("module");
      const q = params.get("q")?.toLowerCase();

      const defs = tag ? ctx.activities.listByTag(tag) : ctx.activities.list();

      const filtered = defs.filter((def) => {
        const mod = def.name.split(".")[0];
        if (module && mod !== module) return false;
        if (q && !def.name.toLowerCase().includes(q)) return false;
        return true;
      });

      const out = filtered.map((def) => ({
        name: def.name,
        module: def.name.split(".")[0],
        version: def.version,
        tags: def.tags ?? [],
        timeoutMs: def.timeoutMs ?? null,
        maxAttempts: def.maxAttempts ?? null,
      }));

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(out));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/ctx.activities/")) {
      const pathOnlyAct = req.url.split("?")[0];
      const parts = pathOnlyAct.split("/");
      if (parts.length !== 3) {
        res.statusCode = 400;
        res.end("Expected /ctx.activities/:name");
        return;
      }

      const name = decodeURIComponent(parts[2]);
      const def = ctx.activities.get(name as any);
      if (!def) {
        res.statusCode = 404;
        res.end("Activity not found");
        return;
      }

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        name: def.name,
        module: def.name.split(".")[0],
        version: def.version,
        tags: def.tags ?? [],
        timeoutMs: def.timeoutMs ?? null,
        maxAttempts: def.maxAttempts ?? null,
      }));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
}
