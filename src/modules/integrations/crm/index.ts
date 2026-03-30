import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { upsertUserActivityDefinition } from "./upsert-user";

export interface CrmConfig extends IntegrationModuleConfig {
  databaseUrl?: string;
}

export const CrmModule: IntegrationModule = {
  name: "crm",
  registerActivities(registry: ActivityRegistry, config: CrmConfig) {
    if (!config.enabled || !config.databaseUrl) {
      return;
    }

    const defs: AnyActivityDefinition[] = [
      upsertUserActivityDefinition(config),
    ];

    for (const def of defs) {
      registry.register(def);
    }
  },
};