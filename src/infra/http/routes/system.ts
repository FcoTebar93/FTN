import type http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SWAGGER_UI_HTML } from "../../swagger-ui";
import type { FtnAppRouteContext } from "../route-context";
import type { DeadLetterStatus } from "../../../shared/dead-letter";
import { sendError, sendJson } from "../response";

function getDeadLetterActionId(rawPath: string, action: "requeue" | "ack"): string | undefined {
  const match = rawPath.match(
    action === "requeue" ? /^\/dead-letters\/([^/]+)\/requeue$/ : /^\/dead-letters\/([^/]+)\/ack$/
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

function sendDeadLetterResult(res: http.ServerResponse, id: string, result: { ok: true } | { ok: false; error: string }): void {
  if (!result.ok) {
    sendError(res, result.error === "Dead letter not found" ? 404 : 409, result.error);
    return;
  }
  sendJson(res, 202, { ok: true, id });
}

async function checkVaultHealth(): Promise<{ configured: boolean; ok?: boolean; error?: string }> {
  const backend = (process.env.FTN_SECRET_STORE_BACKEND ?? "encrypted").trim().toLowerCase();
  if (backend !== "vault") {
    return { configured: false };
  }
  const addr = process.env.FTN_VAULT_ADDR?.trim();
  if (!addr) {
    return { configured: true, ok: false, error: "missing FTN_VAULT_ADDR" };
  }
  const token = process.env.FTN_VAULT_TOKEN?.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${addr.replace(/\/+$/, "")}/v1/sys/health`, {
      method: "GET",
      headers: token ? { "X-Vault-Token": token } : {},
      signal: controller.signal,
    });
    return { configured: true, ok: response.ok };
  } catch (error) {
    return { configured: true, ok: false, error: String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function trySystemRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "GET" && rawPath === "/health") {
    sendJson(res, 200, { status: "ok" });
    return true;
  }

  if (req.method === "GET" && rawPath === "/openapi.json") {
    const specPath = join(process.cwd(), "docs/api/openapi.json");
    if (!existsSync(specPath)) {
      sendError(res, 404, "OpenAPI spec not found");
      return true;
    }
    const raw = readFileSync(specPath, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.end(raw);
    return true;
  }

  if (req.method === "GET" && rawPath === "/docs") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(SWAGGER_UI_HTML);
    return true;
  }

  if (req.method === "GET" && rawPath === "/swagger") {
    res.statusCode = 302;
    res.setHeader("Location", "/docs");
    res.end();
    return true;
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
    const ok = (!ctx.pool || checks.postgres === true) && (!ctx.redis || checks.redis === true);
    sendJson(res, ok ? 200 : 503, { status: ok ? "ready" : "not_ready", checks });
    return true;
  }

  if (req.method === "GET" && rawPath === "/health/deps") {
    const checks: {
      postgres: { configured: boolean; ok?: boolean };
      redis: { configured: boolean; ok?: boolean };
      vault: { configured: boolean; ok?: boolean; error?: string };
    } = {
      postgres: { configured: Boolean(ctx.pool) },
      redis: { configured: Boolean(ctx.redis) },
      vault: { configured: false },
    };

    if (ctx.pool) {
      try {
        await ctx.pool.query("SELECT 1");
        checks.postgres.ok = true;
      } catch {
        checks.postgres.ok = false;
      }
    }
    if (ctx.redis) {
      try {
        await ctx.redis.ping();
        checks.redis.ok = true;
      } catch {
        checks.redis.ok = false;
      }
    }
    checks.vault = await checkVaultHealth();

    const ok =
      (!checks.postgres.configured || checks.postgres.ok === true) &&
      (!checks.redis.configured || checks.redis.ok === true) &&
      (!checks.vault.configured || checks.vault.ok === true);
    sendJson(res, ok ? 200 : 503, { status: ok ? "ok" : "degraded", checks });
    return true;
  }

  if (req.method === "GET" && (rawPath === "/dead-letters" || rawPath.startsWith("/dead-letters?"))) {
    const parsed = new URL(req.url ?? "/dead-letters", "http://127.0.0.1");
    const limit = Math.max(1, Math.min(500, parseInt(parsed.searchParams.get("limit") ?? "100", 10) || 100));
    const queueName = parsed.searchParams.get("queue") ?? undefined;
    const taskType = parsed.searchParams.get("taskType") ?? undefined;
    const statusRaw = parsed.searchParams.get("status");
    const allowedStatus: DeadLetterStatus[] = ["pending", "requeued", "acknowledged"];
    if (statusRaw && !allowedStatus.includes(statusRaw as DeadLetterStatus)) {
      sendError(res, 400, "Invalid status filter. Allowed: pending, requeued, acknowledged");
      return true;
    }
    const status = statusRaw && allowedStatus.includes(statusRaw as DeadLetterStatus)
      ? (statusRaw as DeadLetterStatus)
      : undefined;
    const items = ctx.listDeadLetters({ limit, queueName, taskType, status });
    sendJson(res, 200, { items, total: items.length });
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/dead-letters/") && rawPath.endsWith("/requeue")) {
    const id = getDeadLetterActionId(rawPath, "requeue");
    if (!id) {
      sendError(res, 400, "Invalid dead-letter route");
      return true;
    }
    sendDeadLetterResult(res, id, await ctx.requeueDeadLetter(id));
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/dead-letters/") && rawPath.endsWith("/ack")) {
    const id = getDeadLetterActionId(rawPath, "ack");
    if (!id) {
      sendError(res, 400, "Invalid dead-letter route");
      return true;
    }
    sendDeadLetterResult(res, id, ctx.acknowledgeDeadLetter(id));
    return true;
  }

  return false;
}
