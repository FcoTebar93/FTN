import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";

import type { InlineImagePart } from "./inline-html-images";
import type { NotificationsConfig } from "./index";
import { assertEmailConfig, resolveEmailTransportKind } from "./email-config";

export interface OutboundEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  inlineImages?: InlineImagePart[];
}

export interface EmailTransport {
  kind: "smtp" | "sendgrid";
  send(message: OutboundEmail): Promise<void>;
}

export function createEmailTransport(config: NotificationsConfig): EmailTransport {
  const kind = assertEmailConfig(config);

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
        const attachments =
          message.inlineImages?.map((img) => ({
            filename: img.filename,
            content: img.content,
            contentType: img.contentType,
            cid: img.cid,
          })) ?? [];

        await transporter.sendMail({
          from: message.from,
          to: message.to.join(", "),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        });
      },
    };
  }

  sgMail.setApiKey(config.sendgridApiKey!);
  return {
    kind: "sendgrid",
    async send(message) {
      const sgAttachments =
        message.inlineImages?.map((img) => ({
          content: img.content.toString("base64"),
          filename: img.filename,
          type: img.contentType,
          disposition: "inline" as const,
          content_id: img.cid,
        })) ?? [];

      await sgMail.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(sgAttachments.length > 0 ? { attachments: sgAttachments } : {}),
      });
    },
  };
}

export function canRegisterSendEmail(config: NotificationsConfig): boolean {
  return resolveEmailTransportKind(config) !== undefined;
}