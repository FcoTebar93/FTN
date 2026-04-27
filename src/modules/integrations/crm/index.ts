import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import { upsertUserActivityDefinition } from "./upsert-user";
import type { Pool } from "pg";
import { registerDefinitions, resolvePool } from "../helpers";

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
    const merged = resolvePool(config);
    if (!merged) {
      return;
    }
    registerDefinitions(registry, [upsertUserActivityDefinition(merged)]);
  },
};