import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { NotificationsConfig } from "./index";
import type { SendSlackMessageInput, SendSlackMessageResult } from "./types";

export function sendSlackMessageActivityDefinition(config: NotificationsConfig): ActivityDefinition<SendSlackMessageInput, SendSlackMessageResult> {
  const { slackWebhookUrl } = config;

  if (!slackWebhookUrl) {
    throw new Error("Config inválida para sendSlackMessage: falta slackWebhookUrl");
  }

  return {
    name: "notifications.sendSlackMessage:v1",
    maxAttempts: 3,
    timeoutMs: 10_000,
    tags: ["notifications", "slack"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        channel: { type: "string", description: "Canal de Slack (opcional)" },
        text: { type: "string", description: "Mensaje a enviar" },
      },
      additionalProperties: false,
    },
    
    async execute(input: SendSlackMessageInput, ctx: ActivityExecutionContext): Promise<SendSlackMessageResult> {
      ctx.log("Enviando mensaje a Slack", { text: input.text });

      const fetchFn = globalThis.fetch;

      if (!fetchFn) {
        throw new Error("fetch global no disponible en este entorno");
      }

      const res = await fetchFn(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text }),
      });

      if (!res.ok) {
        throw new Error(`Error enviando a Slack: ${res.status} ${res.statusText}`);
      }
    },
  };
}

