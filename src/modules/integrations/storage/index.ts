import { Pool } from "pg";
import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { dbExecuteActivityDefinition } from "./db-execute";
import { putKeyValueActivityDefinition } from "./put-key-value";
import { getKeyValueActivityDefinition } from "./get-key-value";

export interface StorageConfig {
  enabled: boolean;
  databaseUrl?: string;
  pool?: Pool;
}

export const StorageModule: IntegrationModule = {
  name: "storage",
  registerActivities(registry: ActivityRegistry, config: StorageConfig) {
    if (!config.enabled) return;

    const pool =
      config.pool ??
      (config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : undefined);
    if (!pool) return;

    const merged: StorageConfig = { ...config, pool };

    const defs: AnyActivityDefinition[] = [
      dbExecuteActivityDefinition(merged),
      putKeyValueActivityDefinition(merged),
      getKeyValueActivityDefinition(merged),
    ];

    for (const def of defs) {
      registry.register(def);
    }
  },
};