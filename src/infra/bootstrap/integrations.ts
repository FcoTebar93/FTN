import type Redis from "ioredis";
import type { Pool } from "pg";
import type { IntegrationsConfig } from "../../modules/integrations";
import { getCredential } from "../../app/credentials";

interface BuildIntegrationsConfigInput {
  pool: Pool | undefined;
  redis: Redis | undefined;
  redisUrl: string | undefined;
}

export async function buildIntegrationsConfig(
  input: BuildIntegrationsConfigInput
): Promise<IntegrationsConfig> {
  const { pool, redis, redisUrl } = input;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const systemSubject = process.env.FTN_SYSTEM_SUBJECT?.trim() || "system";
  const stripeCredential = await getCredential(systemSubject, "stripe");
  const twilioCredential = await getCredential(systemSubject, "twilio");
  const kycCredential = await getCredential(systemSubject, "kyc");
  const notificationsCredential = await getCredential(systemSubject, "notifications");
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  const stripeSecretKey =
    str(stripeCredential?.secrets?.stripeSecretKey) ??
    str(stripeCredential?.secrets?.secretKey) ??
    str(stripeCredential?.config?.stripeSecretKey) ??
    str(process.env.STRIPE_SECRET_KEY);

  const sendgridApiKey =
    str(notificationsCredential?.secrets?.sendgridApiKey) ??
    str(notificationsCredential?.secrets?.apiKey) ??
    str(notificationsCredential?.config?.sendgridApiKey) ??
    str(process.env.SENDGRID_API_KEY);
  const emailFrom =
    str(notificationsCredential?.config?.emailFrom) ??
    str(notificationsCredential?.config?.from) ??
    str(process.env.EMAIL_FROM ?? process.env.SMTP_FROM);
  const slackWebhookUrl =
    str(notificationsCredential?.secrets?.slackWebhookUrl) ??
    str(notificationsCredential?.config?.slackWebhookUrl) ??
    str(process.env.SLACK_WEBHOOK_URL);

  const twilioAccountSid =
    str(twilioCredential?.secrets?.accountSid) ??
    str(twilioCredential?.secrets?.twilioAccountSid) ??
    str(twilioCredential?.config?.accountSid) ??
    str(process.env.TWILIO_ACCOUNT_SID);
  const twilioAuthToken =
    str(twilioCredential?.secrets?.authToken) ??
    str(twilioCredential?.secrets?.twilioAuthToken) ??
    str(twilioCredential?.config?.authToken) ??
    str(process.env.TWILIO_AUTH_TOKEN);
  const twilioFromNumber =
    str(twilioCredential?.config?.fromNumber) ??
    str(twilioCredential?.config?.twilioFromNumber) ??
    str(process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER);

  const kycProviderUrl =
    str(kycCredential?.secrets?.providerUrl) ??
    str(kycCredential?.config?.providerUrl) ??
    str(process.env.KYC_PROVIDER_URL);
  const kycProviderToken =
    str(kycCredential?.secrets?.providerToken) ??
    str(kycCredential?.secrets?.token) ??
    str(kycCredential?.config?.providerToken) ??
    str(process.env.KYC_PROVIDER_TOKEN);

  return {
    storage: {
      enabled: !!databaseUrl,
      databaseUrl,
      ...(pool ? { pool } : {}),
    },
    documents: {
      enabled: true,
    },
    notifications: {
      enabled: true,
      sendgridApiKey,
      emailFrom,
      slackWebhookUrl,
      twilioAccountSid,
      twilioAuthToken,
      twilioFromNumber,
    },
    payments: {
      enabled: process.env.FTN_PAYMENTS_DISABLED !== "1" && process.env.FTN_PAYMENTS_DISABLED !== "true",
      stripeSecretKey,
    },
    identity: {
      enabled: true,
      providerUrl: kycProviderUrl,
      providerToken: kycProviderToken,
    },
    logistics: {
      enabled: true,
    },
    crm: {
      enabled: !!databaseUrl,
      databaseUrl,
      ...(pool ? { pool } : {}),
    },
    http: {
      enabled: process.env.FTN_HTTP_DISABLED !== "1" && process.env.FTN_HTTP_DISABLED !== "true",
      allowPrivateUrls: process.env.FTN_HTTP_ALLOW_PRIVATE_URLS === "1",
      maxResponseBodyBytes: 2_000_000,
    },
    messaging: {
      enabled: !!redisUrl,
      ...(redis ? { redis } : {}),
    },
  };
}
