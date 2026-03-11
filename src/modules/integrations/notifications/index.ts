import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { ActivityDefinition } from "../../../core/activities";
import { sendEmailActivityDefinition } from "./send-email-activity";
import { sendSlackMessageActivityDefinition } from "./send-slack-message-activity";

export interface NotificationsConfig {
  enabled: boolean;
  sendgridApiKey?: string;
  emailFrom?: string;
  slackWebhookUrl?: string;
}

export const NotificationsModule: IntegrationModule = {
  name: "notifications",
  registerActivities(registry: ActivityRegistry, config: NotificationsConfig) {
    if (!config.enabled) return;

    const defs: ActivityDefinition<unknown, unknown>[] = [];

    if (config.sendgridApiKey && config.emailFrom) {
      defs.push(sendEmailActivityDefinition(config));
    }

    if (config.slackWebhookUrl) {
      defs.push(sendSlackMessageActivityDefinition(config));
    }

    for (const def of defs) {
      registry.register(def);
    }
  },
};