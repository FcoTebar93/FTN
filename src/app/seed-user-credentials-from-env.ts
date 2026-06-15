import type { AppConfig } from "../infra/config";
import { getCredential, upsertCredential } from "./credentials";

export interface SeedUserCredentialsResult {
  subject: string;
  seeded: string[];
  skipped: string[];
}

function hasEnvStripe(config: AppConfig): boolean {
  const key = config.stripeSecretKey?.trim();
  return Boolean(key && /^sk_(test|live)_/.test(key));
}

function hasEnvEmail(config: AppConfig): boolean {
  const from = config.emailFrom?.trim();
  if (!from?.includes("@")) return false;
  const sendgrid = config.sendgridApiKey?.trim();
  if (sendgrid && /^SG\./.test(sendgrid)) return true;
  return Boolean(
    config.smtpHost?.trim() &&
      config.smtpUser?.trim() &&
      config.smtpPass?.trim()
  );
}

function hasEnvTwilio(config: AppConfig): boolean {
  return Boolean(
    config.twilioAccountSid?.trim() &&
      config.twilioAuthToken?.trim() &&
      config.twilioFromNumber?.trim()
  );
}

function hasEnvKyc(config: AppConfig): boolean {
  return Boolean(config.kycProviderUrl?.trim() && config.kycProviderToken?.trim());
}

function hasEnvGoogleSheets(config: AppConfig): boolean {
  return Boolean(config.googleSheetsServiceAccountJson?.trim());
}

/**
 * Copia secretos de servicios externos desde variables de entorno a Vault/Postgres
 * para un usuario concreto, solo si aún no tiene credencial guardada.
 */
export async function seedUserCredentialsFromEnv(
  subject: string,
  config: AppConfig
): Promise<SeedUserCredentialsResult> {
  const seeded: string[] = [];
  const skipped: string[] = [];

  if (hasEnvStripe(config)) {
    const existing = await getCredential(subject, "stripe");
    if (existing?.hasSecrets) {
      skipped.push("stripe");
    } else {
      await upsertCredential(subject, "stripe", {
        secrets: { stripeSecretKey: config.stripeSecretKey!.trim() },
      });
      seeded.push("stripe");
    }
  }

  if (hasEnvEmail(config)) {
    const existing = await getCredential(subject, "notifications");
    if (existing?.hasSecrets) {
      skipped.push("notifications");
    } else {
      const secrets: Record<string, unknown> = {};
      const cfg: Record<string, unknown> = { emailFrom: config.emailFrom!.trim() };
      if (config.sendgridApiKey?.trim()) {
        secrets.sendgridApiKey = config.sendgridApiKey.trim();
      }
      if (config.smtpHost?.trim()) {
        cfg.smtpHost = config.smtpHost.trim();
        if (config.smtpPort) cfg.smtpPort = String(config.smtpPort);
        if (config.smtpSecure !== undefined) cfg.smtpSecure = String(config.smtpSecure);
      }
      if (config.smtpUser?.trim()) secrets.smtpUser = config.smtpUser.trim();
      if (config.smtpPass?.trim()) secrets.smtpPass = config.smtpPass.replace(/\s+/g, "");
      if (config.slackWebhookUrl?.trim()) secrets.slackWebhookUrl = config.slackWebhookUrl.trim();
      await upsertCredential(subject, "notifications", { config: cfg, secrets });
      seeded.push("notifications");
    }
  }

  if (hasEnvTwilio(config)) {
    const existing = await getCredential(subject, "twilio");
    if (existing?.hasSecrets) {
      skipped.push("twilio");
    } else {
      await upsertCredential(subject, "twilio", {
        config: { fromNumber: config.twilioFromNumber!.trim() },
        secrets: {
          accountSid: config.twilioAccountSid!.trim(),
          authToken: config.twilioAuthToken!.trim(),
        },
      });
      seeded.push("twilio");
    }
  }

  if (hasEnvKyc(config)) {
    const existing = await getCredential(subject, "kyc");
    if (existing?.hasSecrets) {
      skipped.push("kyc");
    } else {
      await upsertCredential(subject, "kyc", {
        secrets: {
          providerUrl: config.kycProviderUrl!.trim(),
          providerToken: config.kycProviderToken!.trim(),
        },
      });
      seeded.push("kyc");
    }
  }

  if (hasEnvGoogleSheets(config)) {
    const existing = await getCredential(subject, "google_sheets");
    if (existing?.hasSecrets) {
      skipped.push("google_sheets");
    } else {
      await upsertCredential(subject, "google_sheets", {
        secrets: { serviceAccountJson: config.googleSheetsServiceAccountJson!.trim() },
        ...(config.googleSheetsImpersonateEmail?.trim()
          ? { config: { impersonateEmail: config.googleSheetsImpersonateEmail.trim() } }
          : {}),
      });
      seeded.push("google_sheets");
    }
  }

  return { subject, seeded, skipped };
}
