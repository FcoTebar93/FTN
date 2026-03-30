import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { NotificationsConfig } from "./index";
import type { SendSmsInput, SendSmsResult } from "./types";

export function sendSmsActivityDefinition(_config: NotificationsConfig): ActivityDefinition<SendSmsInput, SendSmsResult> {
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
      const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      const from =
        process.env.TWILIO_FROM_NUMBER?.trim() ?? process.env.TWILIO_PHONE_NUMBER?.trim();

      if (accountSid && authToken && from) {
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
        const body = new URLSearchParams({
          To: input.to,
          From: from,
          Body: input.text,
        });
        const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Twilio SMS ${res.status}: ${errText.slice(0, 500)}`);
        }
        const json = (await res.json()) as { sid?: string };
        ctx.log("SMS enviado (Twilio)", { to: input.to, sid: json.sid });
        return;
      }

      ctx.log("SMS modo demo (sin TWILIO_*): no se envía mensaje real", {
        to: input.to,
        textLength: input.text.length,
      });
    },
  };
}