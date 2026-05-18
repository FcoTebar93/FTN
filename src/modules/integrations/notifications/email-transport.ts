import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";

import type { NotificationsConfig } from "./index";
import { assertEmailConfig, resolveEmailTransportKind } from "./email-config";

export interface OutboundEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  kind: "smtp" | "sendgrid";
  send(message: OutboundEmail): Promise<void>;
}

export function createEmailTransport(config: NotificationsConfig): EmailTransport {
  const kind = assertEmailConfig(config);
  const from = config.emailFrom!;

  if (kind === "smtp") {
    const port = config.smtpPort ?? 587;
    const secure = config.smtpSecure ?? port === 465;
    const transporter = nodemailer.createTransport({
      host: config.smtpHost!,
      port,
      secure,
      auth: {
        user: config.smtpUser!,
        pass: config.smtpPass!,
      },
    });

    return {
      kind: "smtp",
      async send(message) {
        await transporter.sendMail({
          from: message.from,
          to: message.to.join(", "),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        });
      },
    };
  }

  sgMail.setApiKey(config.sendgridApiKey!);
  return {
    kind: "sendgrid",
    async send(message) {
      await sgMail.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    },
  };
}

export function canRegisterSendEmail(config: NotificationsConfig): boolean {
  return resolveEmailTransportKind(config) !== undefined;
}
