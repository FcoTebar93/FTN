import type http from "node:http";
import { sendError, sendJson } from "../response";
import { insertAuditLog } from "../../users";
import { getCredential, listCredentials, upsertCredential } from "../../../app/credentials";
import type { FtnAppRouteContext } from "../route-context";
import { getPathParams } from "../path-params";
import { readJsonBodyCapped } from "../request";

export async function tryCredentialsRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "GET" && (rawPath === "/credentials" || rawPath.startsWith("/credentials?"))) {
    const items = await listCredentials(ctx.requestSubject);
    sendJson(res, 200, items);
    return true;
  }

  if (req.method === "GET" && rawPath.startsWith("/credentials/")) {
    const parts = getPathParams(rawPath, 3);
    if (!parts || !parts[2]) {
      sendError(res, 400, "Expected /credentials/:provider");
      return true;
    }
    const provider = decodeURIComponent(parts[2]);
    const cred = await getCredential(ctx.requestSubject, provider);
    if (!cred) {
      sendError(res, 404, "Credential not found");
      return true;
    }
    sendJson(res, 200, cred);
    return true;
  }

  if (req.method === "PUT" && rawPath.startsWith("/credentials/")) {
    const parts = getPathParams(rawPath, 3);
    if (!parts || !parts[2]) {
      sendError(res, 400, "Expected /credentials/:provider");
      return true;
    }
    const provider = decodeURIComponent(parts[2]);
    const parsedResult = await readJsonBodyCapped<{
      config?: unknown;
      secrets?: unknown;
    }>(req, res, ctx.apiSecurity.maxBodyBytes);
    if (!parsedResult.ok) return true;
    const parsed = parsedResult.value;
    const config =
      parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)
        ? (parsed.config as Record<string, unknown>)
        : undefined;
    const secrets =
      parsed.secrets && typeof parsed.secrets === "object" && !Array.isArray(parsed.secrets)
        ? (parsed.secrets as Record<string, unknown>)
        : undefined;
    if (!config && !secrets) {
      sendError(res, 400, "Payload must include config or secrets object");
      return true;
    }
    const saved = await upsertCredential(ctx.requestSubject, provider, { config, secrets });
    await insertAuditLog(ctx.pool, {
      subject: ctx.requestSubject,
      action: "credentials.upsert",
      resource: provider,
      detail: { hasConfig: Boolean(config), hasSecrets: Boolean(secrets) },
    });
    sendJson(res, 200, saved);
    return true;
  }

  return false;
}
