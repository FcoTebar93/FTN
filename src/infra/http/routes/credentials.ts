import type http from "node:http";
import { readBodyCapped } from "../security";
import { insertAuditLog } from "../../users";
import { getCredential, listCredentials, upsertCredential } from "../../../app/credentials";
import type { FtnAppRouteContext } from "../route-context";

export async function tryCredentialsRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "GET" && (rawPath === "/credentials" || rawPath.startsWith("/credentials?"))) {
    const items = await listCredentials(ctx.requestSubject);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(items));
    return true;
  }

  if (req.method === "GET" && rawPath.startsWith("/credentials/")) {
    const parts = rawPath.split("/");
    if (parts.length !== 3 || !parts[2]) {
      res.statusCode = 400;
      res.end("Expected /credentials/:provider");
      return true;
    }
    const provider = decodeURIComponent(parts[2]);
    const cred = await getCredential(ctx.requestSubject, provider);
    if (!cred) {
      res.statusCode = 404;
      res.end("Credential not found");
      return true;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(cred));
    return true;
  }

  if (req.method === "PUT" && rawPath.startsWith("/credentials/")) {
    const parts = rawPath.split("/");
    if (parts.length !== 3 || !parts[2]) {
      res.statusCode = 400;
      res.end("Expected /credentials/:provider");
      return true;
    }
    const provider = decodeURIComponent(parts[2]);
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
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
        return true;
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
    return true;
  }

  return false;
}
