import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { MessagingConfig } from "./types";
import { redisPublishActivityDefinition } from "./redis-publish";
import { registerDefinitions } from "../helpers";

export type { MessagingConfig } from "./types";

export const MessagingModule: IntegrationModule = {
  name: "messaging",
  registerActivities(registry: ActivityRegistry, config: MessagingConfig) {
    if (!config.enabled) {
      return;
    }
    if (!config.redis && !config.redisUrl?.trim()) {
      return;
    }

    registerDefinitions(registry, [
      redisPublishActivityDefinition({
        ...config,
        ...(config.redis ? {} : { redisUrl: config.redisUrl!.trim() }),
      }),
    ]);
  },
};
