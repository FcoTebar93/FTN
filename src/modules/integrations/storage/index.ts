import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { dbExecuteActivityDefinition } from "./db-execute";
import { putKeyValueActivityDefinition } from "./put-key-value";
import { getKeyValueActivityDefinition } from "./get-key-value";

export interface StorageConfig {
  enabled: boolean;
  databaseUrl?: string;
}

export const StorageModule: IntegrationModule = {
  name: "storage",
  registerActivities(registry: ActivityRegistry, config: StorageConfig) {
    if (!config.enabled) return;

    const defs: AnyActivityDefinition[] = [];

    if (config.databaseUrl) {
      defs.push(dbExecuteActivityDefinition(config));
      defs.push(putKeyValueActivityDefinition(config));
      defs.push(getKeyValueActivityDefinition(config));
    }

    for (const def of defs) {
      registry.register(def);
    }
  },
};