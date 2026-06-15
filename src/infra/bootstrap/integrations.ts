import type Redis from "ioredis";
import type { Pool } from "pg";
import type { IntegrationsConfig } from "../../modules/integrations";
import { getCredential } from "../../app/credentials";
import { buildGoogleSheetsAuthConfig } from "../../modules/integrations/google-sheets/auth";
import type { AppConfig } from "../config";

export interface BuildIntegrationsConfigInput {
  config: AppConfig;
  pool: Pool | undefined;
  redis: Redis | undefined;
  redisUrl: string | undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function buildIntegrationsConfigForSubject(
  subject: string,
  input: BuildIntegrationsConfigInput
): Promise<IntegrationsConfig> {
  const { config, pool, redis, redisUrl } = input;
  const databaseUrl = config.databaseUrl;
  const stripeCredential = await getCredential(subject, "stripe");
  const twilioCredential = await getCredential(subject, "twilio");
  const kycCredential = await getCredential(subject, "kyc");
  const googleSheetsCredential = await getCredential(subject, "google_sheets");
  const notificationsCredential = await getCredential(subject, "notifications");

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
  const smtpHost =
    str(notificationsCredential?.config?.smtpHost) ??
    str(notificationsCredential?.secrets?.smtpHost) ??
    str(config.smtpHost);
  const smtpPortRaw =
    str(notificationsCredential?.config?.smtpPort) ?? str(config.smtpPort?.toString());
  const smtpPort = smtpPortRaw ? Number.parseInt(smtpPortRaw, 10) : config.smtpPort;
  const smtpSecureRaw = str(notificationsCredential?.config?.smtpSecure);
  const smtpSecure =
    smtpSecureRaw === "true" || smtpSecureRaw === "1"
      ? true
      : smtpSecureRaw === "false" || smtpSecureRaw === "0"
        ? false
        : config.smtpSecure;
  const smtpUser =
    str(notificationsCredential?.secrets?.smtpUser) ??
    str(notificationsCredential?.config?.smtpUser) ??
    str(config.smtpUser);
  const smtpPassRaw =
    str(notificationsCredential?.secrets?.smtpPass) ??
    str(notificationsCredential?.secrets?.smtpPassword) ??
    str(config.smtpPass);
  const smtpPass = smtpPassRaw?.replace(/\s+/g, "");
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

  const googleSheetsOauthRedirectUri =
    config.googleSheetsOauthRedirectUri ??
    `http://localhost:${config.port}/integrations/google-sheets/oauth/callback`;
  const googleSheetsAuth = buildGoogleSheetsAuthConfig({
    credentialSecrets: googleSheetsCredential?.secrets,
    credentialConfig: googleSheetsCredential?.config,
    serviceAccountJsonEnv: config.googleSheetsServiceAccountJson,
    impersonateEmailEnv: config.googleSheetsImpersonateEmail,
    oauthClientId: config.googleSheetsOauthClientId,
    oauthClientSecret: config.googleSheetsOauthClientSecret,
    oauthRedirectUri: googleSheetsOauthRedirectUri,
  });

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
      smtpHost,
      smtpPort: Number.isFinite(smtpPort) && smtpPort! > 0 ? smtpPort : undefined,
      smtpSecure,
      smtpUser,
      smtpPass,
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
    googleSheets: {
      enabled: !config.ftnGoogleSheetsDisabled,
      ...(googleSheetsAuth ? { auth: googleSheetsAuth } : {}),
    },
  };
}

/** Config de arranque (catálogo + fallback global). Usa subject `system` + env. */
export async function buildIntegrationsConfig(input: BuildIntegrationsConfigInput): Promise<IntegrationsConfig> {
  return buildIntegrationsConfigForSubject(input.config.systemSubject, input);
}
