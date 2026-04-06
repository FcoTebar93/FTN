import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

const memoryRevokedJti = new Set<string>();

export async function revokeAccessTokenJti(pool: Pool | undefined, jti: string, expiresAt: Date): Promise<void> {
  if (!jti) return;
  memoryRevokedJti.add(jti);
  if (!pool) return;
  await pool.query(
    `INSERT INTO ftn_revoked_access_tokens (jti, expires_at) VALUES ($1, $2)
     ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [jti, expiresAt.toISOString()]
  );
}

export async function isAccessTokenJtiRevoked(pool: Pool | undefined, jti: string | undefined): Promise<boolean> {
  if (!jti) {
    return false;
  }
  if (memoryRevokedJti.has(jti)) {
    return true;
  }
  if (!pool) {
    return false;
  }
  const r = await pool.query<{ n: string }>(`SELECT 1 AS n FROM ftn_revoked_access_tokens WHERE jti = $1`, [jti]);
  return r.rows.length > 0;
}

function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function newRefreshTokenRaw(): string {
  return randomBytes(32).toString("base64url");
}

export async function storeRefreshToken(pool: Pool, username: string, rawToken: string, expiresAt: Date): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  await pool.query(`INSERT INTO ftn_refresh_tokens (username, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    username,
    tokenHash,
    expiresAt.toISOString(),
  ]);
}

export async function consumeRefreshToken(pool: Pool, rawToken: string): Promise<{ username: string } | null> {
  const tokenHash = hashRefreshToken(rawToken);
  const r = await pool.query<{ username: string }>(
    `DELETE FROM ftn_refresh_tokens WHERE token_hash = $1 AND expires_at > NOW() RETURNING username`,
    [tokenHash]
  );
  const row = r.rows[0];
  return row ? { username: row.username } : null;
}

export async function deleteRefreshTokensForUser(pool: Pool, username: string): Promise<void> {
  await pool.query(`DELETE FROM ftn_refresh_tokens WHERE username = $1`, [username]);
}

export async function insertAuditLog(
  pool: Pool | undefined,
  row: { subject: string; action: string; resource?: string; detail?: Record<string, unknown> }
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO ftn_audit_log (subject, action, resource, detail_json) VALUES ($1, $2, $3, $4::jsonb)`,
    [row.subject, row.action, row.resource ?? null, row.detail ? JSON.stringify(row.detail) : null]
  );
}

export async function insertUser(
  pool: Pool,
  username: string,
  passwordHash: string,
  scopes: string | null = null
): Promise<"ok" | "duplicate"> {
  try {
    await pool.query(`INSERT INTO ftn_users (username, password_hash, scopes) VALUES ($1, $2, $3)`, [
      username,
      passwordHash,
      scopes,
    ]);
    return "ok";
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      return "duplicate";
    }
    throw e;
  }
}

export async function getUserPasswordHash(pool: Pool, username: string): Promise<string | null> {
  const r = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM ftn_users WHERE username = $1`,
    [username]
  );
  return r.rows[0]?.password_hash ?? null;
}

export async function getUserScopesText(pool: Pool, username: string): Promise<string | null> {
  const r = await pool.query<{ scopes: string | null }>(`SELECT scopes FROM ftn_users WHERE username = $1`, [username]);
  const s = r.rows[0]?.scopes;
  if (typeof s !== "string" || !s.trim()) {
    return null;
  }
  return s.trim();
}
