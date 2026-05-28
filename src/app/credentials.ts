import type { Pool } from "pg";
import { decryptCredentials } from "../infra/credentials";
import { getSecretStore } from "../infra/secret-store";

export interface CredentialRecord {
  subject: string;
  provider: string;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  secretBackend?: "encrypted" | "vault";
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
      secret_ref: string | null;
      secret_backend: "encrypted" | "vault" | null;
      encrypted_secrets: string | null;
      updated_at: Date;
    }>(
      `SELECT subject, provider, config_json, secret_ref, secret_backend, encrypted_secrets, updated_at
       FROM ftn_credentials
       WHERE subject = $1
       ORDER BY provider`,
      [subject]
    );
    return rows.map((r) => ({
      subject: r.subject,
      provider: r.provider,
      config: (r.config_json && typeof r.config_json === "object" ? r.config_json : {}) as Record<string, unknown>,
      hasSecrets: Boolean(r.secret_ref ?? r.encrypted_secrets),
      ...(r.secret_backend ? { secretBackend: r.secret_backend } : {}),
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
  const secretStore = getSecretStore();
  if (pool) {
    const { rows } = await pool.query<{
      subject: string;
      config_json: unknown;
      secret_ref: string | null;
      secret_backend: "encrypted" | "vault" | null;
      encrypted_secrets: string | null;
      updated_at: Date;
    }>(
      `SELECT subject, config_json, secret_ref, secret_backend, encrypted_secrets, updated_at
       FROM ftn_credentials
       WHERE subject = $1 AND provider = $2`,
      [subject, provider]
    );
    if (!rows[0]) return undefined;
    const row = rows[0];
    const secretRef = row.secret_ref ?? row.encrypted_secrets;
    return {
      subject: row.subject,
      provider,
      config: (row.config_json && typeof row.config_json === "object" ? row.config_json : {}) as Record<string, unknown>,
      hasSecrets: Boolean(secretRef),
      ...(row.secret_backend ? { secretBackend: row.secret_backend } : {}),
      secrets: secretRef ? await secretStore.load(secretRef) : {},
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
    secrets: local.encryptedSecrets ? await secretStore.load(local.encryptedSecrets) : {},
    updatedAt: local.updatedAt,
  };
}

export async function upsertCredential(
  subject: string,
  provider: string,
  patch: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }
): Promise<CredentialRecord> {
  const secretStore = getSecretStore();
  const existing = await getCredential(subject, provider);
  const config = patch.config ?? existing?.config ?? {};
  const secrets = patch.secrets ?? existing?.secrets ?? {};
  const secretRef = Object.keys(secrets).length > 0 ? await secretStore.save(subject, provider, secrets) : null;
  const secretBackend: "encrypted" | "vault" | null = secretRef ? (secretRef.startsWith("vault:") ? "vault" : "encrypted") : null;
  const updatedAt = new Date().toISOString();

  if (pool) {
    await pool.query(
      `INSERT INTO ftn_credentials (subject, provider, config_json, secret_ref, secret_backend, encrypted_secrets, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $4, NOW())
       ON CONFLICT (subject, provider) DO UPDATE SET
         config_json = EXCLUDED.config_json,
         secret_ref = EXCLUDED.secret_ref,
         secret_backend = EXCLUDED.secret_backend,
         encrypted_secrets = EXCLUDED.encrypted_secrets,
         updated_at = NOW()`,
      [subject, provider, JSON.stringify(config), secretRef, secretBackend]
    );
  } else {
    memory.set(key(subject, provider), { config, encryptedSecrets: secretRef, updatedAt });
  }

  return {
    subject,
    provider,
    config,
    hasSecrets: Boolean(secretRef),
    ...(secretBackend ? { secretBackend } : {}),
    updatedAt,
  };
}

export async function migrateLegacyCredentialSecretsToVault(): Promise<number> {
  if (!pool) return 0;
  const secretStore = getSecretStore();
  const { rows } = await pool.query<{
    subject: string;
    provider: string;
    secret_ref: string | null;
    encrypted_secrets: string;
  }>(
    `SELECT subject, provider, secret_ref, encrypted_secrets
     FROM ftn_credentials
     WHERE encrypted_secrets IS NOT NULL`
  );

  let migrated = 0;
  for (const row of rows) {
    const reference = row.secret_ref ?? row.encrypted_secrets;
    if (secretStore.isManagedReference(reference)) {
      continue;
    }
    const legacySecrets = decryptCredentials(reference);
    const vaultReference = await secretStore.save(row.subject, row.provider, legacySecrets);
    await pool.query(
      `UPDATE ftn_credentials
       SET secret_ref = $3, secret_backend = 'vault', encrypted_secrets = $3, updated_at = NOW()
       WHERE subject = $1 AND provider = $2`,
      [row.subject, row.provider, vaultReference]
    );
    migrated += 1;
  }
  return migrated;
}
