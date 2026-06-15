export type CredentialProvider = "stripe" | "notifications" | "crm" | "twilio" | "kyc" | "google_sheets";
import type { Locale } from "../../i18n";

export type CredentialFieldLocation = "config" | "secrets";
export type CredentialFieldType = "text" | "password" | "url" | "email" | "tel";

export interface CredentialFieldSchema {
  key: string;
  label: string;
  location: CredentialFieldLocation;
  type: CredentialFieldType;
  placeholder?: string;
  description?: string;
  aliases?: string[];
  required?: boolean;
  validate?: (value: string, all: Record<string, string>) => string | null;
}

export interface CredentialProviderSchema {
  provider: CredentialProvider;
  title: string;
  description: string;
  requirements?: string[];
  fields: CredentialFieldSchema[];
  advancedJsonEnabled?: boolean;
  oauthConnect?: boolean;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildProviderSchemas(locale: Locale): Record<CredentialProvider, CredentialProviderSchema> {
  const isEs = locale === "es";
  return {
  stripe: {
    provider: "stripe",
    title: "Stripe",
    description: isEs
      ? "Configura la clave secreta para pagos y checkout."
      : "Configure the secret key for payments and checkout.",
    requirements: isEs
      ? ["`stripeSecretKey` obligatoria", "Debe empezar por sk_test_ o sk_live_"]
      : ["`stripeSecretKey` is required", "Must start with sk_test_ or sk_live_"],
    fields: [
      {
        key: "stripeSecretKey",
        label: "Secret key",
        location: "secrets",
        type: "password",
        aliases: ["secretKey"],
        placeholder: "sk_test_...",
        required: true,
        validate: (value) =>
          value && /^sk_(test|live)_/.test(value)
            ? null
            : isEs
              ? "Debe empezar por sk_test_ o sk_live_."
              : "Must start with sk_test_ or sk_live_.",
      },
    ],
  },
  twilio: {
    provider: "twilio",
    title: "Twilio SMS",
    description: isEs ? "Credenciales para envío de SMS reales." : "Credentials for real SMS delivery.",
    requirements: isEs
      ? ["`accountSid`, `authToken` y `fromNumber`", "SID debe empezar por AC..."]
      : ["`accountSid`, `authToken` and `fromNumber`", "SID must start with AC..."],
    fields: [
      {
        key: "accountSid",
        label: "Account SID",
        location: "secrets",
        type: "password",
        aliases: ["twilioAccountSid"],
        placeholder: "ACxxxxxxxxxxxx",
        required: true,
        validate: (value) =>
          value && /^AC[a-zA-Z0-9]{10,}$/.test(value)
            ? null
            : isEs
              ? "Debe empezar por AC..."
              : "Must start with AC...",
      },
      {
        key: "authToken",
        label: "Auth Token",
        location: "secrets",
        type: "password",
        aliases: ["twilioAuthToken"],
        required: true,
        validate: (value) =>
          value.length >= 10 ? null : isEs ? "Debe tener al menos 10 caracteres." : "Must be at least 10 characters.",
      },
      {
        key: "fromNumber",
        label: "From number",
        location: "config",
        type: "tel",
        aliases: ["twilioFromNumber"],
        placeholder: "+34600000000",
        required: true,
        validate: (value) =>
          value && /^\+?[0-9]{6,}$/.test(value)
            ? null
            : isEs
              ? "Debe ser un teléfono válido (solo números y opcional +)."
              : "Must be a valid phone number (digits and optional +).",
      },
    ],
  },
  kyc: {
    provider: "kyc",
    title: "KYC Provider",
    description: isEs ? "Proveedor externo de verificación de identidad." : "External identity verification provider.",
    requirements: isEs
      ? ["`providerUrl` y `providerToken` obligatorios", "URL debe ser http(s) válida"]
      : ["`providerUrl` and `providerToken` are required", "URL must be a valid http(s) URL"],
    fields: [
      {
        key: "providerUrl",
        label: "Provider URL",
        location: "config",
        type: "url",
        placeholder: "https://api.kyc-provider.com/verify",
        required: true,
        validate: (value) => (isHttpUrl(value) ? null : isEs ? "Debe ser una URL http(s) válida." : "Must be a valid http(s) URL."),
      },
      {
        key: "providerToken",
        label: "Provider token",
        location: "secrets",
        type: "password",
        aliases: ["token"],
        required: true,
        validate: (value) => (value ? null : isEs ? "Token obligatorio." : "Token is required."),
      },
    ],
  },
  notifications: {
    provider: "notifications",
    title: "Email / Slack",
    description: isEs ? "Puedes configurar SendGrid, Slack o ambos." : "You can configure SendGrid, Slack, or both.",
    requirements: isEs
      ? ["SendGrid: `sendgridApiKey` + `emailFrom`", "O Slack: `slackWebhookUrl`"]
      : ["SendGrid: `sendgridApiKey` + `emailFrom`", "Or Slack: `slackWebhookUrl`"],
    fields: [
      {
        key: "sendgridApiKey",
        label: "SendGrid API key",
        location: "secrets",
        aliases: ["apiKey"],
        type: "password",
        placeholder: "SG....",
        validate: (value, all) => {
          if (!value && !all.slackWebhookUrl) return isEs ? "Configura SendGrid o Slack." : "Configure SendGrid or Slack.";
          if (!value) return null;
          return /^SG\./.test(value) ? null : isEs ? "Debe empezar por SG." : "Must start with SG.";
        },
      },
      {
        key: "emailFrom",
        label: "Email from",
        location: "config",
        aliases: ["from"],
        type: "email",
        placeholder: "no-reply@tu-dominio.com",
        validate: (value, all) => {
          if (!all.sendgridApiKey) return null;
          return value && emailRegex.test(value)
            ? null
            : isEs
              ? "Email emisor inválido."
              : "Invalid sender email.";
        },
      },
      {
        key: "slackWebhookUrl",
        label: "Slack webhook URL",
        location: "secrets",
        type: "password",
        placeholder: "https://hooks.slack.com/services/...",
        validate: (value, all) => {
          if (!value && !all.sendgridApiKey) return isEs ? "Configura SendGrid o Slack." : "Configure SendGrid or Slack.";
          if (!value) return null;
          return /^https:\/\/hooks\.slack\.com\//.test(value)
            ? null
            : isEs
              ? "Webhook inválido: debe ser hooks.slack.com."
              : "Invalid webhook: must be hooks.slack.com.";
        },
      },
    ],
  },
  crm: {
    provider: "crm",
    title: "CRM",
    description: isEs
      ? "Actualmente CRM no usa credenciales de proveedor en este entorno."
      : "CRM currently does not use provider credentials in this environment.",
    fields: [],
    advancedJsonEnabled: true,
  },
  google_sheets: {
    provider: "google_sheets",
    title: "Google Sheets",
    description: isEs
      ? "Conecta tu cuenta de Google para leer y escribir hojas de cálculo desde tus workflows."
      : "Connect your Google account to read and write spreadsheets from your workflows.",
    requirements: isEs
      ? ["Cada usuario conecta su propia cuenta de Google", "No hace falta compartir la hoja con una service account"]
      : ["Each user connects their own Google account", "No need to share the sheet with a service account"],
    fields: [],
    oauthConnect: true,
    advancedJsonEnabled: true,
  },
  };
}

export const PROVIDER_SCHEMAS: Record<CredentialProvider, CredentialProviderSchema> = buildProviderSchemas("es");
export function getProviderSchemas(locale: Locale): Record<CredentialProvider, CredentialProviderSchema> {
  return buildProviderSchemas(locale);
}

export const PROVIDERS_ORDER: CredentialProvider[] = ["stripe", "notifications", "google_sheets", "crm", "twilio", "kyc"];

/** Integraciones del designer que se configuran en /credentials */
export const INTEGRATION_CREDENTIAL_PROVIDER: Partial<Record<string, CredentialProvider>> = {
  stripe: "stripe",
  notifications: "notifications",
  google_sheets: "google_sheets",
  twilio: "twilio",
  kyc: "kyc",
};

export function credentialsPathForIntegration(integrationKey: string): string | undefined {
  const provider = INTEGRATION_CREDENTIAL_PROVIDER[integrationKey];
  if (!provider) return undefined;
  return `/credentials?provider=${encodeURIComponent(provider)}`;
}

export function getFieldErrors(
  schema: CredentialProviderSchema,
  values: Record<string, string>,
  locale: Locale = "es"
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of schema.fields) {
    const value = (values[field.key] ?? "").trim();
    if (field.required && !value) {
      result[field.key] = locale === "es" ? "Campo obligatorio." : "Required field.";
      continue;
    }
    if (field.validate) {
      const err = field.validate(value, values);
      if (err) {
        result[field.key] = err;
      }
    }
  }
  return result;
}

export function countMissingRequiredFields(schema: CredentialProviderSchema, values: Record<string, string>): number {
  return schema.fields.filter((field) => field.required && !(values[field.key] ?? "").trim()).length;
}
