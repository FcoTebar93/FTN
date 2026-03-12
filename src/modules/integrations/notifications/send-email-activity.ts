import sgMail from "@sendgrid/mail";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { NotificationsConfig } from "./index";
import type { SendEmailInput, SendEmailResult } from "./types";

export function sendEmailActivityDefinition(config: NotificationsConfig): ActivityDefinition<SendEmailInput, SendEmailResult> {
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
    inputSchema: {
      type: "object",
      required: ["to"],
      properties: {
        to: {
          anyOf: [
            { type: "string", format: "email" },
            { type: "array", items: { type: "string", format: "email" } },
          ],
          description: "Destinatario(s)",
        },
        subject: { type: "string", description: "Asunto del email" },
        templateId: { type: "string", description: "Plantilla SendGrid (opcional)" },
        htmlBody: { type: "string", description: "Cuerpo HTML" },
        textBody: { type: "string", description: "Cuerpo texto plano" },
        locale: { type: "string", description: "Locale/idioma" },
        variables: {
          type: "object",
          description: "Variables para plantillas",
          additionalProperties: true,
        },
      },
    },

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

