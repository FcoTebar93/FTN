import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { sendEmailActivityDefinition } from "./send-email-activity";
import { sendSlackMessageActivityDefinition } from "./send-slack-message-activity";
import { sendWebhookActivityDefinition } from "./send-webhook-activity";
import { sendSmsActivityDefinition } from "./send-sms-activity";
import { registerDefinitions } from "../helpers";

export interface NotificationsConfig extends IntegrationModuleConfig {
  sendgridApiKey?: string;
  emailFrom?: string;
  slackWebhookUrl?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
}

export const NotificationsModule: IntegrationModule = {
  name: "notifications",
  registerActivities(registry: ActivityRegistry, config: NotificationsConfig) {
    if (!config.enabled) return;

    const defs: AnyActivityDefinition[] = [];

    if (config.sendgridApiKey && config.emailFrom) {
      defs.push(sendEmailActivityDefinition(config));
    }

    if (config.slackWebhookUrl) {
      defs.push(sendSlackMessageActivityDefinition(config));
    }

    defs.push(sendWebhookActivityDefinition(config));
    defs.push(sendSmsActivityDefinition(config));

    registerDefinitions(registry, defs);
  },
};