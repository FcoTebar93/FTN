import type Redis from "ioredis";
import type { Pool } from "pg";
import type { IntegrationsConfig } from "../../modules/integrations";
import { getCredential } from "../../app/credentials";
import type { AppConfig } from "../config";

interface BuildIntegrationsConfigInput {
  config: AppConfig;
  pool: Pool | undefined;
  redis: Redis | undefined;
  redisUrl: string | undefined;
}

export async function buildIntegrationsConfig(
  input: BuildIntegrationsConfigInput
): Promise<IntegrationsConfig> {
  const { config, pool, redis, redisUrl } = input;
  const databaseUrl = config.databaseUrl;
  const systemSubject = config.systemSubject;
  const stripeCredential = await getCredential(systemSubject, "stripe");
  const twilioCredential = await getCredential(systemSubject, "twilio");
  const kycCredential = await getCredential(systemSubject, "kyc");
  const notificationsCredential = await getCredential(systemSubject, "notifications");
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  const stripeSecretKey =
    str(stripeCredential?.secrets?.stripeSecretKey) ??
    str(stripeCredential?.secrets?.secretKey) ??
    str(stripeCredential?.config?.stripeSecretKey) ??
    str(config.stripeSecretKey);

  const sendgridApiKey =
    str(notificationsCredential?.secrets?.sendgridApiKey) ??
    str(notificationsCredential?.secrets?.apiKey) ??
    str(notificationsCredential?.config?.sendgridApiKey) ??
    str(config.sendgridApiKey);
  const emailFrom =
    str(notificationsCredential?.config?.emailFrom) ??
    str(notificationsCredential?.config?.from) ??
    str(config.emailFrom);
  const slackWebhookUrl =
    str(notificationsCredential?.secrets?.slackWebhookUrl) ??
    str(notificationsCredential?.config?.slackWebhookUrl) ??
    str(config.slackWebhookUrl);

  const twilioAccountSid =
    str(twilioCredential?.secrets?.accountSid) ??
    str(twilioCredential?.secrets?.twilioAccountSid) ??
    str(twilioCredential?.config?.accountSid) ??
    str(config.twilioAccountSid);
  const twilioAuthToken =
    str(twilioCredential?.secrets?.authToken) ??
    str(twilioCredential?.secrets?.twilioAuthToken) ??
    str(twilioCredential?.config?.authToken) ??
    str(config.twilioAuthToken);
  const twilioFromNumber =
    str(twilioCredential?.config?.fromNumber) ??
    str(twilioCredential?.config?.twilioFromNumber) ??
    str(config.twilioFromNumber);

  const kycProviderUrl =
    str(kycCredential?.secrets?.providerUrl) ??
    str(kycCredential?.config?.providerUrl) ??
    str(config.kycProviderUrl);
  const kycProviderToken =
    str(kycCredential?.secrets?.providerToken) ??
    str(kycCredential?.secrets?.token) ??
    str(kycCredential?.config?.providerToken) ??
    str(config.kycProviderToken);

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
      enabled: !config.ftnPaymentsDisabled,
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
      enabled: !config.ftnHttpDisabled,
      allowPrivateUrls: config.ftnHttpAllowPrivateUrls,
      maxResponseBodyBytes: 2_000_000,
    },
    messaging: {
      enabled: !!redisUrl,
      ...(redis ? { redis } : {}),
    },
  };
}
