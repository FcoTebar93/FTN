export type CredentialProvider = "stripe" | "notifications" | "crm" | "twilio" | "kyc";

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

export const PROVIDER_SCHEMAS: Record<CredentialProvider, CredentialProviderSchema> = {
  stripe: {
    provider: "stripe",
    title: "Stripe",
    description: "Configura la clave secreta para pagos y checkout.",
    requirements: ["`stripeSecretKey` obligatoria", "Debe empezar por sk_test_ o sk_live_"],
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
            : "Debe empezar por sk_test_ o sk_live_.",
      },
    ],
  },
  twilio: {
    provider: "twilio",
    title: "Twilio SMS",
    description: "Credenciales para envío de SMS reales.",
    requirements: ["`accountSid`, `authToken` y `fromNumber`", "SID debe empezar por AC..."],
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
          value && /^AC[a-zA-Z0-9]{10,}$/.test(value) ? null : "Debe empezar por AC...",
      },
      {
        key: "authToken",
        label: "Auth Token",
        location: "secrets",
        type: "password",
        aliases: ["twilioAuthToken"],
        required: true,
        validate: (value) => (value.length >= 10 ? null : "Debe tener al menos 10 caracteres."),
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
            : "Debe ser un teléfono válido (solo números y opcional +).",
      },
    ],
  },
  kyc: {
    provider: "kyc",
    title: "KYC Provider",
    description: "Proveedor externo de verificación de identidad.",
    requirements: ["`providerUrl` y `providerToken` obligatorios", "URL debe ser http(s) válida"],
    fields: [
      {
        key: "providerUrl",
        label: "Provider URL",
        location: "config",
        type: "url",
        placeholder: "https://api.kyc-provider.com/verify",
        required: true,
        validate: (value) => (isHttpUrl(value) ? null : "Debe ser una URL http(s) válida."),
      },
      {
        key: "providerToken",
        label: "Provider token",
        location: "secrets",
        type: "password",
        aliases: ["token"],
        required: true,
        validate: (value) => (value ? null : "Token obligatorio."),
      },
    ],
  },
  notifications: {
    provider: "notifications",
    title: "Email / Slack",
    description: "Puedes configurar SendGrid, Slack o ambos.",
    requirements: ["SendGrid: `sendgridApiKey` + `emailFrom`", "O Slack: `slackWebhookUrl`"],
    fields: [
      {
        key: "sendgridApiKey",
        label: "SendGrid API key",
        location: "secrets",
        aliases: ["apiKey"],
        type: "password",
        placeholder: "SG....",
        validate: (value, all) => {
          if (!value && !all.slackWebhookUrl) return "Configura SendGrid o Slack.";
          if (!value) return null;
          return /^SG\./.test(value) ? null : "Debe empezar por SG.";
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
          return value && emailRegex.test(value) ? null : "Email emisor inválido.";
        },
      },
      {
        key: "slackWebhookUrl",
        label: "Slack webhook URL",
        location: "secrets",
        type: "password",
        placeholder: "https://hooks.slack.com/services/...",
        validate: (value, all) => {
          if (!value && !all.sendgridApiKey) return "Configura SendGrid o Slack.";
          if (!value) return null;
          return /^https:\/\/hooks\.slack\.com\//.test(value)
            ? null
            : "Webhook inválido: debe ser hooks.slack.com.";
        },
      },
    ],
  },
  crm: {
    provider: "crm",
    title: "CRM",
    description: "Actualmente CRM no usa credenciales de proveedor en este entorno.",
    fields: [],
    advancedJsonEnabled: true,
  },
};

export const PROVIDERS_ORDER: CredentialProvider[] = ["stripe", "notifications", "crm", "twilio", "kyc"];

export function getFieldErrors(schema: CredentialProviderSchema, values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of schema.fields) {
    const value = (values[field.key] ?? "").trim();
    if (field.required && !value) {
      result[field.key] = "Campo obligatorio.";
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
