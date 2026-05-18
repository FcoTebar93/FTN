import type { NotificationsConfig } from "./index";

export type EmailTransportKind = "smtp" | "sendgrid";

export function normalizeSmtpPassword(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\s+/g, "");
}

export function hasSendgridEmailConfig(config: NotificationsConfig): boolean {
  return Boolean(config.sendgridApiKey?.trim() && config.emailFrom?.includes("@"));
}

export function hasSmtpEmailConfig(config: NotificationsConfig): boolean {
  return Boolean(
    config.smtpHost?.trim() &&
      config.smtpUser?.trim() &&
      config.smtpPass &&
      config.emailFrom?.includes("@")
  );
}

export function resolveEmailTransportKind(config: NotificationsConfig): EmailTransportKind | undefined {
  if (hasSmtpEmailConfig(config)) return "smtp";
  if (hasSendgridEmailConfig(config)) return "sendgrid";
  return undefined;
}

export function assertEmailConfig(config: NotificationsConfig): EmailTransportKind {
  const kind = resolveEmailTransportKind(config);
  if (!kind) {
    throw new Error(
      "Config inválida para sendEmail: configura SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM) o SendGrid (SENDGRID_API_KEY, EMAIL_FROM)"
    );
  }
  return kind;
}
