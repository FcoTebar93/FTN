import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import { dbExecuteActivityDefinition } from "./db-execute";
import { putKeyValueActivityDefinition } from "./put-key-value";
import { getKeyValueActivityDefinition } from "./get-key-value";
import type { Pool } from "pg";
import { registerDefinitions, resolvePool } from "../helpers";

export interface StorageConfig {
  enabled: boolean;
  databaseUrl?: string;
  pool?: Pool;
}

export const StorageModule: IntegrationModule = {
  name: "storage",
  registerActivities(registry: ActivityRegistry, config: StorageConfig) {
    if (!config.enabled) return;
    const merged = resolvePool(config);
    if (!merged) return;
    registerDefinitions(registry, [
      dbExecuteActivityDefinition(merged),
      putKeyValueActivityDefinition(merged),
      getKeyValueActivityDefinition(merged),
    ]);
  },
};