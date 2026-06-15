import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import { executeHttpRequest } from "../http/client";
import { integrationsConfigForActivity } from "../runtime";
import type { SendSmsInput, SendSmsResult } from "./types";

export function sendSmsActivityDefinition(): ActivityDefinition<SendSmsInput, SendSmsResult> {
  return {
    name: "notifications.sendSms:v1",
    maxAttempts: 3,
    timeoutMs: 10_000,
    tags: ["notifications", "sms"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["to", "text"],
      properties: {
        to: { type: "string", description: "Número de teléfono destino" },
        text: { type: "string", description: "Contenido del SMS" },
      },
      additionalProperties: false,
    },

    async execute(input: SendSmsInput, ctx: ActivityExecutionContext): Promise<SendSmsResult> {
      const notifications = (await integrationsConfigForActivity(ctx)).notifications;
      const accountSid = notifications.twilioAccountSid?.trim();
      const authToken = notifications.twilioAuthToken?.trim();
      const from = notifications.twilioFromNumber?.trim();

      if (accountSid && authToken && from) {
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
        const body = new URLSearchParams({
          To: input.to,
          From: from,
          Body: input.text,
        });
        const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
        const response = await executeHttpRequest(
          {
            url,
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
            timeoutMs: 10_000,
          },
          { requireOk: true }
        );
        const sid =
          response.bodyJson && typeof response.bodyJson === "object" && "sid" in response.bodyJson
            ? String((response.bodyJson as { sid?: unknown }).sid ?? "")
            : undefined;
        ctx.log("SMS enviado (Twilio)", { to: input.to, sid });
        return;
      }

      ctx.log("SMS modo demo (sin credenciales Twilio): no se envía mensaje real", {
        to: input.to,
        textLength: input.text.length,
      });
    },
  };
}
