import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import type { MessagingConfig } from "./types";
import { redisPublishActivityDefinition } from "./redis-publish";

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

    const defs: AnyActivityDefinition[] = [
      redisPublishActivityDefinition({
        ...config,
        ...(config.redis ? {} : { redisUrl: config.redisUrl!.trim() }),
      }),
    ];

    for (const def of defs) {
      registry.register(def);
    }
  },
};
