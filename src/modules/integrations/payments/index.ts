import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { stripeCreateCheckoutSessionActivityDefinition } from "./stripe-create-checkout-session";

export interface PaymentsConfig {
  enabled: boolean;
  stripeSecretKey?: string;
}

export const PaymentsModule: IntegrationModule = {
  name: "payments",
  registerActivities(registry: ActivityRegistry, config: PaymentsConfig) {
    if (!config.enabled) return;

    const defs: AnyActivityDefinition[] = [];

    if (config.stripeSecretKey) {
      defs.push(stripeCreateCheckoutSessionActivityDefinition(config));
    }

    for (const def of defs) {
      registry.register(def);
    }
  },
};