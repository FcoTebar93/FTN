import sgMail from "@sendgrid/mail";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { NotificationsConfig } from "./index";
import type { SendEmailInput, SendEmailResult } from "./types";

export function sendEmailActivityDefinition(
  config: NotificationsConfig
): ActivityDefinition<SendEmailInput, SendEmailResult> {
  const { sendgridApiKey, emailFrom } = config;

  if (!sendgridApiKey || !emailFrom) {
    throw new Error("Config inválida para sendEmail: falta sendgridApiKey o emailFrom");
  }

  sgMail.setApiKey(sendgridApiKey);

  return {
    name: "notifications.sendEmail:v1",
    maxAttempts: 3,
    timeoutMs: 15_000,
    tags: ["notifications", "email"],
    version: "v1",
    async execute(input: SendEmailInput, ctx: ActivityExecutionContext): Promise<SendEmailResult> {
      ctx.log("Enviando email", { to: input.to, subject: input.subject });

      const to = Array.isArray(input.to) ? input.to : [input.to];

      const msg: any = {
        from: emailFrom,
        to,
        subject: input.subject ?? "[FTN] Notificación",
        ...(input.textBody ? { text: input.textBody } : {}),
        ...(input.htmlBody ? { html: input.htmlBody } : {}),
      };

      await sgMail.send(msg);
    },
  };
}

