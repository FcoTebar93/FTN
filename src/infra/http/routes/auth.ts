import type http from "node:http";
import { readBodyCapped, extractBearerOrApiKey } from "../security";
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
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
      return true;
    }

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;

    let parsed: { username?: unknown; password?: unknown };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON" }));
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
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return true;
      }
      const storedHash = await getUserPasswordHash(ctx.pool, normalized);
      if (!storedHash || !(await verifyPassword(p, storedHash))) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return true;
      }
      const scopeFromDb = await getUserScopesText(ctx.pool, normalized);
      ({ token, expiresIn } = issueAccessTokenForSubject(ctx.apiSecurity, normalized, { scopeStrOverride: scopeFromDb }));
      subjectForAudit = normalized;
    } else {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid credentials" }));
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
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(bodyOut));
    return true;
  }

  if (req.method === "POST" && rawPath === "/auth/register") {
    if (!ctx.pool || !ctx.apiSecurity.registrationEnabled || !ctx.apiSecurity.jwtSecret) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Registration is not available" }));
      return true;
    }

    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;

    let parsed: { username?: unknown; password?: unknown };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
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
      return true;
    }

    const passwordHash = await hashPassword(rawPass);
    const inserted = await insertUser(ctx.pool, normalized, passwordHash);
    if (inserted === "duplicate") {
      res.statusCode = 409;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Username already taken" }));
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
    res.statusCode = 201;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(bodyReg));
    return true;
  }

  if (req.method === "POST" && rawPath === "/auth/refresh") {
    if (!ctx.pool || !ctx.apiSecurity.jwtSecret) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Refresh is not available" }));
      return true;
    }
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    let parsed: { refresh_token?: unknown };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const rt = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
    if (!rt.trim()) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing refresh_token" }));
      return true;
    }
    const consumed = await consumeRefreshToken(ctx.pool, rt.trim());
    if (!consumed) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid refresh token" }));
      return true;
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
    return true;
  }

  if (req.method === "POST" && rawPath === "/auth/logout") {
    const rawTok = extractBearerOrApiKey(req);
    if (!rawTok || !ctx.apiSecurity.jwtSecret) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
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
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (req.method === "GET" && rawPath === "/audit/logs") {
    if (!ctx.pool) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Audit log requires Postgres" }));
      return true;
    }
    const auditUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const lim = Math.min(500, Math.max(1, parseInt(auditUrl.searchParams.get("limit") ?? "50", 10) || 50));
    const r = await ctx.pool.query(
      `SELECT occurred_at, subject, action, resource, detail_json FROM ftn_audit_log ORDER BY occurred_at DESC LIMIT $1`,
      [lim]
    );
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ items: r.rows }));
    return true;
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
    return true;
  }

  return false;
}
