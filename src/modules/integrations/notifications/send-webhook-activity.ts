import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import { executeHttpRequest } from "../http/client";
import type { NotificationsConfig } from "./index";
import type { SendWebhookInput, SendWebhookResult } from "./types";

export function sendWebhookActivityDefinition(_config: NotificationsConfig): ActivityDefinition<SendWebhookInput, SendWebhookResult> {
  return {
    name: "notifications.sendWebhook:v1",
    maxAttempts: 3,
    timeoutMs: 15_000,
    tags: ["notifications", "webhook"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "URL del webhook" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "Método HTTP (por defecto POST)",
        },
        headers: {
          type: "object",
          additionalProperties: true,
          description: "Cabeceras adicionales",
        },
        body: { description: "Payload del webhook (cualquier JSON)" },
        timeoutMs: { type: "integer", description: "Timeout en ms (opcional)" },
      },
    },

    async execute(input: SendWebhookInput, ctx: ActivityExecutionContext): Promise<SendWebhookResult> {
      const method = input.method ?? "POST";

      ctx.log("Enviando webhook", {
        url: input.url,
        method,
      });
      const response = await executeHttpRequest(
        { ...input, method, timeoutMs: input.timeoutMs ?? 10_000 },
        {
          allowPrivateUrls: true,
          requireOk: true,
        }
      );
      return { status: response.status };
    },
  };
}