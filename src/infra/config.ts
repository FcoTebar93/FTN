import type { ApiSecurityConfig } from "./http/security";
import { loadApiSecurityConfigFromEnv } from "./http/security";
import type { SecretStoreBackend } from "./secret-store";

function toTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

function parseSmtpPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseIntMin(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Math.max(min, Number.isFinite(parsed) ? parsed : fallback);
}

function parseSecretStoreBackend(value: string | undefined): SecretStoreBackend {
  const normalized = (value ?? "encrypted").trim().toLowerCase();
  if (normalized === "vault") return "vault";
  return "encrypted";
}

export interface AppConfig {
  rawEnv: NodeJS.ProcessEnv;
  systemSubject: string;
  port: number;
  engineDatabaseUrl?: string;
  databaseUrl?: string;
  redisUrl?: string;
  redisKeyPrefix?: string;
  multiTenantEnabled: boolean;
  tenantMaxConcurrentRuns: number;
  idempotencyTtlMs: number;
  refreshTtlSeconds: number;
  defaultUserUsername: string;
  defaultUserPassword: string;
  recoverIntervalMs: number;
  staleLeaseMs: number;
  designerSchedulerIntervalMs: number;
  deadLetterMaxItems: number;
  workflowConcurrencyRetryMaxAttempts: number;
  workflowConcurrencyRetryBaseDelayMs: number;
  workflowConcurrencyRetryMaxDelayMs: number;
  workflowConcurrencyRetryJitterRatio: number;
  ftnHttpDisabled: boolean;
  ftnHttpAllowPrivateUrls: boolean;
  ftnPaymentsDisabled: boolean;
  ftnGoogleSheetsDisabled: boolean;
  googleSheetsServiceAccountJson?: string;
  googleSheetsImpersonateEmail?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  sendgridApiKey?: string;
  emailFrom?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  slackWebhookUrl?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  kycProviderUrl?: string;
  kycProviderToken?: string;
  credentialsEncryptionKey?: string;
  secretStoreBackend: SecretStoreBackend;
  vaultAddress?: string;
  vaultToken?: string;
  vaultMount: string;
  vaultPathPrefix: string;
  vaultTimeoutMs: number;
  vaultMigrateLegacy: boolean;
  logFormatJson: boolean;
  otelDisabled: boolean;
  otelServiceName: string;
  apiSecurity: ApiSecurityConfig;
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    rawEnv: env,
    systemSubject: toTrimmed(env.FTN_SYSTEM_SUBJECT) ?? "system",
    port: env.PORT ? Number(env.PORT) : 4000,
    engineDatabaseUrl: toTrimmed(env.FTN_ENGINE_DATABASE_URL) ?? toTrimmed(env.DATABASE_URL),
    databaseUrl: toTrimmed(env.DATABASE_URL),
    redisUrl: toTrimmed(env.REDIS_URL),
    redisKeyPrefix: toTrimmed(env.FTN_REDIS_KEY_PREFIX),
    multiTenantEnabled: parseBoolean(env.FTN_MULTI_TENANT_ENABLED),
    tenantMaxConcurrentRuns: parseIntMin(env.FTN_TENANT_MAX_CONCURRENT_RUNS, 100, 1),
    idempotencyTtlMs: parseIntMin(env.FTN_IDEMPOTENCY_TTL_MS, 24 * 60 * 60 * 1000, 60_000),
    refreshTtlSeconds: parseIntMin(env.FTN_REFRESH_TTL_SECONDS, 604800, 60),
    defaultUserUsername: toTrimmed(env.FTN_DEFAULT_USER_USERNAME) ?? "demo",
    defaultUserPassword: toTrimmed(env.FTN_DEFAULT_USER_PASSWORD) ?? "demo-password-123",
    recoverIntervalMs: Number(env.FTN_REDIS_RECOVER_INTERVAL_MS ?? "60000"),
    staleLeaseMs: Number(env.FTN_REDIS_STALE_LEASE_MS ?? String(10 * 60 * 1000)),
    designerSchedulerIntervalMs: parseIntMin(env.FTN_DESIGNER_SCHEDULER_INTERVAL_MS, 30000, 10_000),
    deadLetterMaxItems: parseIntMin(env.FTN_DEAD_LETTER_MAX_ITEMS, 1000, 100),
    workflowConcurrencyRetryMaxAttempts: parseIntMin(env.FTN_WORKFLOW_CONCURRENCY_RETRY_MAX_ATTEMPTS, 8, 1),
    workflowConcurrencyRetryBaseDelayMs: Math.max(
      0,
      Number.parseInt(env.FTN_WORKFLOW_CONCURRENCY_RETRY_BASE_DELAY_MS ?? "25", 10) || 25
    ),
    workflowConcurrencyRetryMaxDelayMs: parseIntMin(env.FTN_WORKFLOW_CONCURRENCY_RETRY_MAX_DELAY_MS, 1000, 1),
    workflowConcurrencyRetryJitterRatio: Math.max(
      0,
      Number.parseFloat(env.FTN_WORKFLOW_CONCURRENCY_RETRY_JITTER_RATIO ?? "0.2") || 0.2
    ),
    ftnHttpDisabled: parseBoolean(env.FTN_HTTP_DISABLED),
    ftnHttpAllowPrivateUrls: parseBoolean(env.FTN_HTTP_ALLOW_PRIVATE_URLS),
    ftnPaymentsDisabled: parseBoolean(env.FTN_PAYMENTS_DISABLED),
    ftnGoogleSheetsDisabled: parseBoolean(env.FTN_GOOGLE_SHEETS_DISABLED),
    googleSheetsServiceAccountJson: toTrimmed(env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON),
    googleSheetsImpersonateEmail: toTrimmed(env.GOOGLE_SHEETS_IMPERSONATE_EMAIL),
    stripeSecretKey: toTrimmed(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: toTrimmed(env.STRIPE_WEBHOOK_SECRET),
    sendgridApiKey: toTrimmed(env.SENDGRID_API_KEY),
    emailFrom: toTrimmed(env.EMAIL_FROM ?? env.SMTP_FROM),
    smtpHost: toTrimmed(env.SMTP_HOST),
    smtpPort: parseSmtpPort(env.SMTP_PORT),
    smtpSecure: parseOptionalBoolean(env.SMTP_SECURE),
    smtpUser: toTrimmed(env.SMTP_USER),
    smtpPass: toTrimmed(env.SMTP_PASS ?? env.SMTP_PASSWORD)?.replace(/\s+/g, ""),
    slackWebhookUrl: toTrimmed(env.SLACK_WEBHOOK_URL),
    twilioAccountSid: toTrimmed(env.TWILIO_ACCOUNT_SID),
    twilioAuthToken: toTrimmed(env.TWILIO_AUTH_TOKEN),
    twilioFromNumber: toTrimmed(env.TWILIO_FROM_NUMBER ?? env.TWILIO_PHONE_NUMBER),
    kycProviderUrl: toTrimmed(env.KYC_PROVIDER_URL),
    kycProviderToken: toTrimmed(env.KYC_PROVIDER_TOKEN),
    credentialsEncryptionKey: toTrimmed(env.FTN_CREDENTIALS_ENCRYPTION_KEY),
    secretStoreBackend: parseSecretStoreBackend(env.FTN_SECRET_STORE_BACKEND),
    vaultAddress: toTrimmed(env.FTN_VAULT_ADDR),
    vaultToken: toTrimmed(env.FTN_VAULT_TOKEN),
    vaultMount: toTrimmed(env.FTN_VAULT_MOUNT) ?? "secret",
    vaultPathPrefix: toTrimmed(env.FTN_VAULT_PATH_PREFIX) ?? "ftn/credentials",
    vaultTimeoutMs: parseIntMin(env.FTN_VAULT_TIMEOUT_MS, 5000, 500),
    vaultMigrateLegacy: parseBoolean(env.FTN_VAULT_MIGRATE_LEGACY),
    logFormatJson: (env.LOG_FORMAT ?? "").trim() === "json",
    otelDisabled: parseBoolean(env.FTN_OTEL_DISABLED),
    otelServiceName: toTrimmed(env.OTEL_SERVICE_NAME) ?? "ftn-workflow-engine",
    apiSecurity: loadApiSecurityConfigFromEnv(env),
  };
}
