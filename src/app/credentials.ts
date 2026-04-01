import type { Pool } from "pg";
import { decryptCredentials, encryptCredentials } from "../infra/credentials";

export interface CredentialRecord {
  subject: string;
  provider: string;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  updatedAt: string;
}

export interface CredentialDetail extends CredentialRecord {
  secrets: Record<string, unknown>;
}

let pool: Pool | undefined;
const memory = new Map<string, { config: Record<string, unknown>; encryptedSecrets: string | null; updatedAt: string }>();

export function configureCredentialsStore(p: Pool | undefined): void {
  pool = p;
}

function key(subject: string, provider: string): string {
  return `${subject}::${provider}`;
}

export async function listCredentials(subject: string): Promise<CredentialRecord[]> {
  if (pool) {
    const { rows } = await pool.query<{
      subject: string;
      provider: string;
      config_json: unknown;
      encrypted_secrets: string | null;
      updated_at: Date;
    }>(
      `SELECT subject, provider, config_json, encrypted_secrets, updated_at
       FROM ftn_credentials
       WHERE subject = $1
       ORDER BY provider`,
      [subject]
    );
    return rows.map((r) => ({
      subject: r.subject,
      provider: r.provider,
      config: (r.config_json && typeof r.config_json === "object" ? r.config_json : {}) as Record<string, unknown>,
      hasSecrets: Boolean(r.encrypted_secrets),
      updatedAt: r.updated_at.toISOString(),
    }));
  }
  return Array.from(memory.entries())
    .filter(([k]) => k.startsWith(`${subject}::`))
    .map(([k, v]) => ({
      subject,
      provider: k.split("::")[1] ?? "",
      config: v.config,
      hasSecrets: Boolean(v.encryptedSecrets),
      updatedAt: v.updatedAt,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function getCredential(subject: string, provider: string): Promise<CredentialDetail | undefined> {
  if (pool) {
    const { rows } = await pool.query<{
      subject: string;
      config_json: unknown;
      encrypted_secrets: string | null;
      updated_at: Date;
    }>(
      `SELECT subject, config_json, encrypted_secrets, updated_at
       FROM ftn_credentials
       WHERE subject = $1 AND provider = $2`,
      [subject, provider]
    );
    if (!rows[0]) return undefined;
    const row = rows[0];
    return {
      subject: row.subject,
      provider,
      config: (row.config_json && typeof row.config_json === "object" ? row.config_json : {}) as Record<string, unknown>,
      hasSecrets: Boolean(row.encrypted_secrets),
      secrets: row.encrypted_secrets ? decryptCredentials(row.encrypted_secrets) : {},
      updatedAt: row.updated_at.toISOString(),
    };
  }
  const local = memory.get(key(subject, provider));
  if (!local) return undefined;
  return {
    subject,
    provider,
    config: local.config,
    hasSecrets: Boolean(local.encryptedSecrets),
    secrets: local.encryptedSecrets ? decryptCredentials(local.encryptedSecrets) : {},
    updatedAt: local.updatedAt,
  };
}

export async function upsertCredential(
  subject: string,
  provider: string,
  patch: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }
): Promise<CredentialRecord> {
  const existing = await getCredential(subject, provider);
  const config = patch.config ?? existing?.config ?? {};
  const secrets = patch.secrets ?? existing?.secrets ?? {};
  const encryptedSecrets = Object.keys(secrets).length > 0 ? encryptCredentials(secrets) : null;
  const updatedAt = new Date().toISOString();

  if (pool) {
    await pool.query(
      `INSERT INTO ftn_credentials (subject, provider, config_json, encrypted_secrets, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (subject, provider) DO UPDATE SET
         config_json = EXCLUDED.config_json,
         encrypted_secrets = EXCLUDED.encrypted_secrets,
         updated_at = NOW()`,
      [subject, provider, JSON.stringify(config), encryptedSecrets]
    );
  } else {
    memory.set(key(subject, provider), { config, encryptedSecrets, updatedAt });
  }

  return {
    subject,
    provider,
    config,
    hasSecrets: Boolean(encryptedSecrets),
    updatedAt,
  };
}
