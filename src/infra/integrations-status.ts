export interface IntegrationStatusItem {
  key: string;
  label: string;
  configured: boolean;
  source: "credentials" | "env" | "none";
  details?: string;
}

export interface IntegrationCredential {
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}

export interface BuildIntegrationsStatusDeps {
  hasPostgres: boolean;
  hasRedis: boolean;
  getCredential: (subject: string, provider: string) => Promise<IntegrationCredential | null | undefined>;
  env?: NodeJS.ProcessEnv;
}

export async function buildIntegrationsStatusForSubject(
  subject: string,
  deps: BuildIntegrationsStatusDeps
): Promise<IntegrationStatusItem[]> {
  const env = deps.env ?? {};
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const isHttpUrl = (v: string | undefined): boolean => {
    if (!v) return false;
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };
  const isStripeSecretKey = (v: string | undefined): boolean => Boolean(v && /^sk_(test|live)_/.test(v));

  const credStripe = await deps.getCredential(subject, "stripe");
  const stripeKey =
    str(obj(credStripe?.secrets).stripeSecretKey) ??
    str(obj(credStripe?.secrets).secretKey) ??
    str(obj(credStripe?.config).stripeSecretKey);
  const stripeEnvKey = str(env.STRIPE_SECRET_KEY);
  const stripeConfigured = Boolean((stripeKey && isStripeSecretKey(stripeKey)) || (stripeEnvKey && isStripeSecretKey(stripeEnvKey)));
  const stripeSource: "credentials" | "env" | "none" = stripeKey ? "credentials" : stripeEnvKey ? "env" : "none";
  const stripeDetails = stripeConfigured
    ? undefined
    : stripeKey || stripeEnvKey
      ? "Formato inválido: stripeSecretKey debe empezar por sk_test_ o sk_live_."
      : "Falta stripeSecretKey en credenciales (secrets/config) o STRIPE_SECRET_KEY en entorno.";

  const credTwilio = await deps.getCredential(subject, "twilio");
  const twilioSid =
    str(obj(credTwilio?.secrets).accountSid) ??
    str(obj(credTwilio?.secrets).twilioAccountSid) ??
    str(obj(credTwilio?.config).accountSid);
  const twilioToken =
    str(obj(credTwilio?.secrets).authToken) ??
    str(obj(credTwilio?.secrets).twilioAuthToken) ??
    str(obj(credTwilio?.config).authToken);
  const twilioFrom =
    str(obj(credTwilio?.config).fromNumber) ??
    str(obj(credTwilio?.config).twilioFromNumber) ??
    str(env.TWILIO_FROM_NUMBER ?? env.TWILIO_PHONE_NUMBER);
  const twilioEnv = str(env.TWILIO_ACCOUNT_SID) && str(env.TWILIO_AUTH_TOKEN) ? true : false;
  const twilioConfigured = Boolean(
    (twilioSid &&
      twilioToken &&
      twilioFrom &&
      /^AC[a-zA-Z0-9]{10,}$/.test(twilioSid) &&
      twilioToken.length >= 10 &&
      /^\+?[0-9]{6,}$/.test(twilioFrom)) ||
      twilioEnv
  );
  const twilioSource: "credentials" | "env" | "none" =
    twilioSid && twilioToken && twilioFrom ? "credentials" : twilioEnv ? "env" : "none";
  const twilioDetails = twilioConfigured
    ? undefined
    : twilioSid || twilioToken || twilioFrom
      ? "Formato inválido en Twilio: accountSid debe iniciar por AC..., authToken >= 10 chars y fromNumber debe parecer teléfono."
      : "Faltan accountSid/authToken/fromNumber en twilio o TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (+ from).";

  const credKyc = await deps.getCredential(subject, "kyc");
  const kycUrl =
    str(obj(credKyc?.secrets).providerUrl) ??
    str(obj(credKyc?.config).providerUrl) ??
    str(env.KYC_PROVIDER_URL);
  const kycToken =
    str(obj(credKyc?.secrets).providerToken) ??
    str(obj(credKyc?.secrets).token) ??
    str(obj(credKyc?.config).providerToken) ??
    str(env.KYC_PROVIDER_TOKEN);
  const kycEnv = Boolean(str(env.KYC_PROVIDER_URL) && str(env.KYC_PROVIDER_TOKEN));
  const kycConfigured = Boolean((kycUrl && kycToken && isHttpUrl(kycUrl)) || kycEnv);
  const kycSource: "credentials" | "env" | "none" = kycUrl && kycToken ? "credentials" : kycEnv ? "env" : "none";
  const kycDetails = kycConfigured
    ? undefined
    : kycUrl || kycToken
      ? "Formato inválido en KYC: providerUrl debe ser http(s) válido y providerToken no vacío."
      : "Faltan providerUrl y providerToken para KYC.";

  const credNotifications = await deps.getCredential(subject, "notifications");
  const sendgridKey =
    str(obj(credNotifications?.secrets).sendgridApiKey) ??
    str(obj(credNotifications?.secrets).apiKey) ??
    str(obj(credNotifications?.config).sendgridApiKey);
  const emailFrom =
    str(obj(credNotifications?.config).emailFrom) ??
    str(obj(credNotifications?.config).from) ??
    str(env.EMAIL_FROM ?? env.SMTP_FROM);
  const slackWebhook =
    str(obj(credNotifications?.secrets).slackWebhookUrl) ??
    str(obj(credNotifications?.config).slackWebhookUrl) ??
    str(env.SLACK_WEBHOOK_URL);
  const smtpHost =
    str(obj(credNotifications?.config).smtpHost) ??
    str(obj(credNotifications?.secrets).smtpHost) ??
    str(env.SMTP_HOST);
  const smtpUser =
    str(obj(credNotifications?.secrets).smtpUser) ??
    str(obj(credNotifications?.config).smtpUser) ??
    str(env.SMTP_USER);
  const smtpPassRaw =
    str(obj(credNotifications?.secrets).smtpPass) ??
    str(obj(credNotifications?.secrets).smtpPassword) ??
    str(env.SMTP_PASS ?? env.SMTP_PASSWORD);
  const smtpPass = smtpPassRaw?.replace(/\s+/g, "");
  const sendgridEnv = Boolean(str(env.SENDGRID_API_KEY) && str(env.EMAIL_FROM ?? env.SMTP_FROM));
  const smtpEnv = Boolean(
    str(env.SMTP_HOST) &&
      str(env.SMTP_USER) &&
      str(env.SMTP_PASS ?? env.SMTP_PASSWORD) &&
      str(env.EMAIL_FROM ?? env.SMTP_FROM)?.includes("@")
  );
  const slackEnv = Boolean(str(env.SLACK_WEBHOOK_URL));
  const sendgridConfigured = Boolean(
    (sendgridKey && /^SG\./.test(sendgridKey) && emailFrom && emailFrom.includes("@")) || sendgridEnv
  );
  const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass && emailFrom && emailFrom.includes("@"));
  const slackConfigured = Boolean(
    (slackWebhook && /^https:\/\/hooks\.slack\.com\//.test(slackWebhook)) || slackEnv
  );
  const notificationsConfigured = sendgridConfigured || smtpConfigured || slackConfigured;
  const notificationsFromCredentials = Boolean(
    (sendgridKey && emailFrom) ||
      (smtpHost && smtpUser && smtpPass && emailFrom) ||
      slackWebhook
  );
  const notificationsSource: "credentials" | "env" | "none" = notificationsFromCredentials
    ? "credentials"
    : sendgridEnv || smtpEnv || slackEnv
      ? "env"
      : "none";
  const notificationsDetails = notificationsConfigured
    ? undefined
    : sendgridKey || emailFrom || slackWebhook || smtpHost || smtpUser
      ? "Formato inválido en notifications: SendGrid key debe empezar por SG., SMTP requiere host/user/pass, emailFrom debe ser email, slackWebhookUrl debe ser hooks.slack.com."
      : "Configura SendGrid (SENDGRID_API_KEY + EMAIL_FROM), SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM) o slackWebhookUrl.";

  return [
    {
      key: "stripe",
      label: "Stripe",
      configured: stripeConfigured,
      source: stripeSource,
      details: stripeDetails,
    },
    {
      key: "twilio",
      label: "Twilio SMS",
      configured: twilioConfigured,
      source: twilioSource,
      details: twilioDetails,
    },
    {
      key: "kyc",
      label: "KYC Provider",
      configured: kycConfigured,
      source: kycSource,
      details: kycDetails,
    },
    {
      key: "notifications",
      label: "Email/Slack",
      configured: notificationsConfigured,
      source: notificationsSource,
      details: notificationsDetails,
    },
    {
      key: "postgres",
      label: "Postgres",
      configured: deps.hasPostgres,
      source: deps.hasPostgres ? "env" : "none",
    },
    {
      key: "redis",
      label: "Redis",
      configured: deps.hasRedis,
      source: deps.hasRedis ? "env" : "none",
    },
  ];
}
