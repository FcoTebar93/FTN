import { Pool } from "pg";
import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { upsertUserActivityDefinition } from "./upsert-user";

export interface CrmConfig extends IntegrationModuleConfig {
  databaseUrl?: string;
  pool?: Pool;
}

export const CrmModule: IntegrationModule = {
  name: "crm",
  registerActivities(registry: ActivityRegistry, config: CrmConfig) {
    if (!config.enabled) {
      return;
    }

    const pool =
      config.pool ??
      (config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : undefined);
    if (!pool) {
      return;
    }

    const merged: CrmConfig = { ...config, pool };

    const defs: AnyActivityDefinition[] = [
      upsertUserActivityDefinition(merged),
    ];

    for (const def of defs) {
      registry.register(def);
    }
  },
};