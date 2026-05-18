import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import { createEmailTransport } from "./email-transport";
import { assertEmailConfig } from "./email-config";
import { extractDataUrlImagesToCid } from "./inline-html-images";
import type { NotificationsConfig } from "./index";
import type { SendEmailInput, SendEmailResult } from "./types";

export function sendEmailActivityDefinition(
  config: NotificationsConfig
): ActivityDefinition<SendEmailInput, SendEmailResult> {
  const transportKind = assertEmailConfig(config);
  const emailFrom = config.emailFrom!;
  const transport = createEmailTransport(config);

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
        templateId: { type: "string", description: "Plantilla SendGrid (opcional, solo SendGrid)" },
        htmlBody: {
          type: "string",
          description:
            "Cuerpo HTML. Las imágenes data:image/...;base64,... en atributos src se convierten a inline CID (Gmail, Outlook, etc.).",
        },
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
      ctx.log("Enviando email", { to: input.to, subject: input.subject, transport: transportKind });

      const to = Array.isArray(input.to) ? input.to : [input.to];

      if (transportKind === "smtp" && input.templateId) {
        throw new Error("templateId no está soportado con transporte SMTP");
      }

      let html = input.htmlBody;
      let inlineImages = undefined as ReturnType<typeof extractDataUrlImagesToCid>["inlineImages"] | undefined;
      if (html) {
        const prepared = extractDataUrlImagesToCid(html);
        html = prepared.html;
        inlineImages = prepared.inlineImages.length > 0 ? prepared.inlineImages : undefined;
        if (inlineImages) {
          ctx.log("Imágenes data: URL convertidas a CID inline", { count: inlineImages.length });
        }
      }

      await transport.send({
        from: emailFrom,
        to,
        subject: input.subject ?? "[FTN] Notificación",
        text: input.textBody ?? "Notificación FTN",
        ...(html ? { html } : {}),
        ...(inlineImages ? { inlineImages } : {}),
      });
    },
  };
}