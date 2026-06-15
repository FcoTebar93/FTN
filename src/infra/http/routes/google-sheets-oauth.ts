import type http from "node:http";
import { upsertCredential } from "../../../app/credentials";
import { insertAuditLog } from "../../users";
import type { FtnAppRouteContext } from "../route-context";
import { sendError, sendJson } from "../response";
import {
  buildGoogleSheetsAuthorizationUrl,
  createGoogleSheetsOAuthState,
  exchangeGoogleSheetsOAuthCode,
  verifyGoogleSheetsOAuthState,
  type GoogleSheetsOAuthConfig,
} from "../../../modules/integrations/google-sheets/oauth";

function redirect(res: http.ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function credentialsRedirect(ctx: FtnAppRouteContext, params: Record<string, string>): string {
  const base = ctx.googleSheetsOAuth?.frontendBaseUrl ?? "http://localhost:5173";
  const url = new URL("/credentials", base);
  url.searchParams.set("provider", "google_sheets");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function oauthConfigFromContext(ctx: FtnAppRouteContext): GoogleSheetsOAuthConfig | undefined {
  const cfg = ctx.googleSheetsOAuth;
  if (!cfg?.enabled || !cfg.clientId || !cfg.clientSecret || !cfg.redirectUri || !cfg.stateSigningSecret) {
    return undefined;
  }
  return {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
    stateSigningSecret: cfg.stateSigningSecret,
  };
}

export async function tryGoogleSheetsOAuthRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  const oauthCfg = oauthConfigFromContext(ctx);

  if (req.method === "GET" && rawPath === "/integrations/google-sheets/oauth/start") {
    if (!oauthCfg) {
      sendError(res, 503, "Google Sheets OAuth no configurado en el servidor");
      return true;
    }
    const state = createGoogleSheetsOAuthState(ctx.requestSubject, oauthCfg.stateSigningSecret);
    const url = buildGoogleSheetsAuthorizationUrl(oauthCfg, state);
    sendJson(res, 200, { url });
    return true;
  }

  if (req.method === "GET" && rawPath === "/integrations/google-sheets/oauth/callback") {
    if (!oauthCfg) {
      redirect(res, credentialsRedirect(ctx, { oauth_error: "oauth_not_configured" }));
      return true;
    }

    const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    const oauthError = params.get("error");
    if (oauthError) {
      redirect(res, credentialsRedirect(ctx, { oauth_error: oauthError }));
      return true;
    }

    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      redirect(res, credentialsRedirect(ctx, { oauth_error: "missing_code_or_state" }));
      return true;
    }

    const verified = verifyGoogleSheetsOAuthState(state, oauthCfg.stateSigningSecret);
    if (!verified) {
      redirect(res, credentialsRedirect(ctx, { oauth_error: "invalid_state" }));
      return true;
    }

    try {
      const tokens = await exchangeGoogleSheetsOAuthCode(oauthCfg, code);
      await upsertCredential(verified.subject, "google_sheets", {
        config: {
          authType: "oauth2",
          connectedEmail: tokens.email,
          connectedAt: new Date().toISOString(),
        },
        secrets: {
          refreshToken: tokens.refreshToken,
        },
      });
      await insertAuditLog(ctx.pool, {
        subject: verified.subject,
        action: "credentials.oauth.google_sheets",
        resource: "google_sheets",
        detail: { connectedEmail: tokens.email ?? null },
      });
      redirect(res, credentialsRedirect(ctx, { connected: "1" }));
    } catch (e) {
      redirect(res, credentialsRedirect(ctx, { oauth_error: (e as Error).message }));
    }
    return true;
  }

  if (req.method === "DELETE" && rawPath === "/integrations/google-sheets/oauth") {
    const existing = await upsertCredential(ctx.requestSubject, "google_sheets", {
      config: { authType: "oauth2" },
      secrets: {},
    });
    await insertAuditLog(ctx.pool, {
      subject: ctx.requestSubject,
      action: "credentials.oauth.google_sheets.disconnect",
      resource: "google_sheets",
      detail: { hadSecrets: existing.hasSecrets },
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
