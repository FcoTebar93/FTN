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
    async execute(input: SendSmsInput, ctx: ActivityExecutionContext): Promise<SendSmsResult> {
      ctx.log("Enviando SMS", {
        to: input.to,
        text: input.text,
      });

      // TODO: Integrate with a SMS provider

      return;
    },
  };
}