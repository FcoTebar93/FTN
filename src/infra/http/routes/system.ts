import type http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SWAGGER_UI_HTML } from "../../swagger-ui";
import type { FtnAppRouteContext } from "../route-context";

export async function trySystemRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "GET" && rawPath === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok" }));
    return true;
  }

  if (req.method === "GET" && rawPath === "/openapi.json") {
    const specPath = join(process.cwd(), "docs/api/openapi.json");
    if (!existsSync(specPath)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "OpenAPI spec not found" }));
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
    res.statusCode = ok ? 200 : 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: ok ? "ready" : "not_ready", checks }));
    return true;
  }

  if (req.method === "GET" && (rawPath === "/dead-letters" || rawPath.startsWith("/dead-letters?"))) {
    const parsed = new URL(req.url ?? "/dead-letters", "http://127.0.0.1");
    const limit = Math.max(1, Math.min(500, parseInt(parsed.searchParams.get("limit") ?? "100", 10) || 100));
    const queueName = parsed.searchParams.get("queue") ?? undefined;
    const taskType = parsed.searchParams.get("taskType") ?? undefined;
    const items = ctx.listDeadLetters({ limit, queueName, taskType });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ items, total: items.length }));
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/dead-letters/") && rawPath.endsWith("/requeue")) {
    const match = rawPath.match(/^\/dead-letters\/([^/]+)\/requeue$/);
    if (!match) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid dead-letter route" }));
      return true;
    }
    const id = decodeURIComponent(match[1]);
    const result = await ctx.requeueDeadLetter(id);
    if (!result.ok) {
      res.statusCode = result.error === "Dead letter not found" ? 404 : 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: result.error }));
      return true;
    }
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, id }));
    return true;
  }

  if (req.method === "POST" && rawPath.startsWith("/dead-letters/") && rawPath.endsWith("/ack")) {
    const match = rawPath.match(/^\/dead-letters\/([^/]+)\/ack$/);
    if (!match) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid dead-letter route" }));
      return true;
    }
    const id = decodeURIComponent(match[1]);
    const result = ctx.acknowledgeDeadLetter(id);
    if (!result.ok) {
      res.statusCode = result.error === "Dead letter not found" ? 404 : 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: result.error }));
      return true;
    }
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, id }));
    return true;
  }

  return false;
}
