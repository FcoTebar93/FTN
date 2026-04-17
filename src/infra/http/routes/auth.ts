import type http from "node:http";
import { readBodyCapped, extractBearerOrApiKey } from "../security";
import { sendError, sendJson } from "../response";
import {
  isAuthConfigured,
  isLoginConfigured,
  issueAccessToken,
  issueAccessTokenForSubject,
  validateLoginCredentials,
  verifyJwtHs256,
} from "../auth";
import { normalizeAndValidateUsername, validatePlainPassword } from "../registration";
import { hashPassword, verifyPassword } from "../../passwords";
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
} from "../../users";
import type { FtnAppRouteContext } from "../route-context";

export async function tryAuthAndAuditRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string
): Promise<boolean> {
  if (req.method === "POST" && rawPath === "/auth/login") {
    if (!isLoginConfigured(ctx.apiSecurity) && !ctx.hasDbLogin) {
      sendError(res, 404, "Not found");
      return true;
    }

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;

    let parsed: { username?: unknown; password?: unknown };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      sendError(res, 400, "Invalid JSON");
      return true;
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
        sendError(res, 401, "Invalid credentials");
        return true;
      }
      const storedHash = await getUserPasswordHash(ctx.pool, normalized);
      if (!storedHash || !(await verifyPassword(p, storedHash))) {
        sendError(res, 401, "Invalid credentials");
        return true;
      }
      const scopeFromDb = await getUserScopesText(ctx.pool, normalized);
      ({ token, expiresIn } = issueAccessTokenForSubject(ctx.apiSecurity, normalized, { scopeStrOverride: scopeFromDb }));
      subjectForAudit = normalized;
    } else {
      sendError(res, 401, "Invalid credentials");
      return true;
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
    sendJson(res, 200, bodyOut);
    return true;
  }

  if (req.method === "POST" && rawPath === "/auth/register") {
    if (!ctx.pool || !ctx.apiSecurity.registrationEnabled || !ctx.apiSecurity.jwtSecret) {
      sendError(res, 503, "Registration is not available");
      return true;
    }

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;

    let parsed: { username?: unknown; password?: unknown };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      sendError(res, 400, "Invalid JSON");
      return true;
    }

    const rawUser = typeof parsed.username === "string" ? parsed.username : "";
    const rawPass = typeof parsed.password === "string" ? parsed.password : "";
    const normalized = normalizeAndValidateUsername(rawUser);
    if (!normalized || !validatePlainPassword(rawPass)) {
      sendError(
        res,
        400,
        "Invalid username or password",
        "Usuario: 3–64 caracteres (letras, números, _, ., -). Contraseña: mínimo 10 caracteres."
      );
      return true;
    }

    const passwordHash = await hashPassword(rawPass);
    const inserted = await insertUser(ctx.pool, normalized, passwordHash);
    if (inserted === "duplicate") {
      sendError(res, 409, "Username already taken");
      return true;
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
    sendJson(res, 201, bodyReg);
    return true;
  }

  if (req.method === "POST" && rawPath === "/auth/refresh") {
    if (!ctx.pool || !ctx.apiSecurity.jwtSecret) {
      sendError(res, 503, "Refresh is not available");
      return true;
    }
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    let parsed: { refresh_token?: unknown };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      sendError(res, 400, "Invalid JSON");
      return true;
    }
    const rt = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
    if (!rt.trim()) {
      sendError(res, 400, "Missing refresh_token");
      return true;
    }
    const consumed = await consumeRefreshToken(ctx.pool, rt.trim());
    if (!consumed) {
      sendError(res, 401, "Invalid refresh token");
      return true;
    }
    const scopeFromDb = await getUserScopesText(ctx.pool, consumed.username);
    const issued = issueAccessTokenForSubject(ctx.apiSecurity, consumed.username, { scopeStrOverride: scopeFromDb });
    const refreshRaw = newRefreshTokenRaw();
    await storeRefreshToken(ctx.pool, consumed.username, refreshRaw, new Date(Date.now() + ctx.refreshTtlSeconds * 1000));
    sendJson(res, 200, {
      access_token: issued.token,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      refresh_token: refreshRaw,
      refresh_expires_in: ctx.refreshTtlSeconds,
    });
    return true;
  }

  if (req.method === "POST" && rawPath === "/auth/logout") {
    const rawTok = extractBearerOrApiKey(req);
    if (!rawTok || !ctx.apiSecurity.jwtSecret) {
      sendError(res, 401, "Unauthorized");
      return true;
    }
    const payload = verifyJwtHs256(rawTok, ctx.apiSecurity.jwtSecret, {
      issuer: ctx.apiSecurity.jwtIssuer,
      audience: ctx.apiSecurity.jwtAudience,
    });
    const jti = typeof payload?.jti === "string" ? payload.jti : undefined;
    if (!jti) {
      sendError(res, 400, "Token cannot be revoked (missing jti)");
      return true;
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
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && rawPath === "/audit/logs") {
    if (!ctx.pool) {
      sendError(res, 503, "Audit log requires Postgres");
      return true;
    }
    const auditUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const lim = Math.min(500, Math.max(1, parseInt(auditUrl.searchParams.get("limit") ?? "50", 10) || 50));
    const r = await ctx.pool.query(
      `SELECT occurred_at, subject, action, resource, detail_json FROM ftn_audit_log ORDER BY occurred_at DESC LIMIT $1`,
      [lim]
    );
    sendJson(res, 200, { items: r.rows });
    return true;
  }

  if (req.method === "GET" && rawPath === "/auth/status") {
    sendJson(res, 200, {
      loginConfigured: isLoginConfigured(ctx.apiSecurity) || ctx.hasDbLogin,
      authRequired: isAuthConfigured(ctx.apiSecurity),
      registrationEnabled: Boolean(ctx.apiSecurity.registrationEnabled && ctx.pool),
    });
    return true;
  }

  return false;
}
