import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import { verifyIdentityActivityDefinition } from "./verify-identity";
import { checkFraudScoreActivityDefinition } from "./check-fraud-score";
import { registerDefinitions } from "../helpers";

export interface IdentityConfig extends IntegrationModuleConfig {
  providerUrl?: string;
  providerToken?: string;
}

export const IdentityModule: IntegrationModule = {
  name: "identity",
  registerActivities(registry: ActivityRegistry, config: IdentityConfig) {
    if (!config.enabled) {
      return;
    }
    const defs = [
      verifyIdentityActivityDefinition(config),
      checkFraudScoreActivityDefinition(),
    ];
    registerDefinitions(registry, defs);
  },
};