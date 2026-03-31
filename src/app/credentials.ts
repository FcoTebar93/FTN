import type { Pool } from "pg";
import { decryptCredentials, encryptCredentials } from "../infra/credentials";

export interface CredentialRecord {
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

export async function listCredentials(): Promise<CredentialRecord[]> {
  if (pool) {
    const { rows } = await pool.query<{
      provider: string;
      config_json: unknown;
      encrypted_secrets: string | null;
      updated_at: Date;
    }>(`SELECT provider, config_json, encrypted_secrets, updated_at FROM ftn_credentials ORDER BY provider`);
    return rows.map((r) => ({
      provider: r.provider,
      config: (r.config_json && typeof r.config_json === "object" ? r.config_json : {}) as Record<string, unknown>,
      hasSecrets: Boolean(r.encrypted_secrets),
      updatedAt: r.updated_at.toISOString(),
    }));
  }
  return Array.from(memory.entries())
    .map(([provider, v]) => ({
      provider,
      config: v.config,
      hasSecrets: Boolean(v.encryptedSecrets),
      updatedAt: v.updatedAt,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function getCredential(provider: string): Promise<CredentialDetail | undefined> {
  if (pool) {
    const { rows } = await pool.query<{
      config_json: unknown;
      encrypted_secrets: string | null;
      updated_at: Date;
    }>(`SELECT config_json, encrypted_secrets, updated_at FROM ftn_credentials WHERE provider = $1`, [provider]);
    if (!rows[0]) return undefined;
    const row = rows[0];
    return {
      provider,
      config: (row.config_json && typeof row.config_json === "object" ? row.config_json : {}) as Record<string, unknown>,
      hasSecrets: Boolean(row.encrypted_secrets),
      secrets: row.encrypted_secrets ? decryptCredentials(row.encrypted_secrets) : {},
      updatedAt: row.updated_at.toISOString(),
    };
  }
  const local = memory.get(provider);
  if (!local) return undefined;
  return {
    provider,
    config: local.config,
    hasSecrets: Boolean(local.encryptedSecrets),
    secrets: local.encryptedSecrets ? decryptCredentials(local.encryptedSecrets) : {},
    updatedAt: local.updatedAt,
  };
}

export async function upsertCredential(
  provider: string,
  patch: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }
): Promise<CredentialRecord> {
  const existing = await getCredential(provider);
  const config = patch.config ?? existing?.config ?? {};
  const secrets = patch.secrets ?? existing?.secrets ?? {};
  const encryptedSecrets = Object.keys(secrets).length > 0 ? encryptCredentials(secrets) : null;
  const updatedAt = new Date().toISOString();

  if (pool) {
    await pool.query(
      `INSERT INTO ftn_credentials (provider, config_json, encrypted_secrets, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (provider) DO UPDATE SET
         config_json = EXCLUDED.config_json,
         encrypted_secrets = EXCLUDED.encrypted_secrets,
         updated_at = NOW()`,
      [provider, JSON.stringify(config), encryptedSecrets]
    );
  } else {
    memory.set(provider, { config, encryptedSecrets, updatedAt });
  }

  return {
    provider,
    config,
    hasSecrets: Boolean(encryptedSecrets),
    updatedAt,
  };
}
