import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { NotificationsConfig } from "./index";
import type { SendWebhookInput, SendWebhookResult } from "./types";

export function sendWebhookActivityDefinition(_config: NotificationsConfig): ActivityDefinition<SendWebhookInput, SendWebhookResult> {
  return {
    name: "notifications.sendWebhook:v1",
    maxAttempts: 3,
    timeoutMs: 15_000,
    tags: ["notifications", "webhook"],
    version: "v1",
    async execute(input: SendWebhookInput, ctx: ActivityExecutionContext): Promise<SendWebhookResult> {
      const method = input.method ?? "POST";

      ctx.log("Enviando webhook", {
        url: input.url,
        method,
      });

      const fetchFn: (url: string, init?: any) => Promise<any> =
        (globalThis as any).fetch;

      if (!fetchFn) {
        throw new Error("fetch global no disponible en este entorno");
      }

      const controller = new AbortController();
      const timeout = input.timeoutMs ?? 10000;
      const id = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetchFn(input.url, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(input.headers ?? {}),
          },
          body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Webhook error: ${res.status} ${res.statusText}`);
        }

        return { status: res.status };
      } finally {
        clearTimeout(id);
      }
    },
  };
}