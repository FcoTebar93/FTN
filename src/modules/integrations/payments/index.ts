import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { stripeCreateCheckoutSessionActivityDefinition } from "./stripe-create-checkout-session";
import { validateOrderActivityDefinition } from "./validate-order";
import { chargePaymentActivityDefinition } from "./charge-payment";
import { getPaymentStatusActivityDefinition } from "./get-payment-status";
import { registerDefinitions } from "../helpers";

export interface PaymentsConfig extends IntegrationModuleConfig {
  stripeSecretKey?: string;
}

export const PaymentsModule: IntegrationModule = {
  name: "payments",
  registerActivities(registry: ActivityRegistry, config: PaymentsConfig) {
    if (!config.enabled) {
      return;
    }

    const defs: AnyActivityDefinition[] = [
      validateOrderActivityDefinition() as AnyActivityDefinition,
      chargePaymentActivityDefinition() as AnyActivityDefinition,
      stripeCreateCheckoutSessionActivityDefinition() as AnyActivityDefinition,
      getPaymentStatusActivityDefinition() as AnyActivityDefinition,
    ];

    registerDefinitions(registry, defs);
  },
};
