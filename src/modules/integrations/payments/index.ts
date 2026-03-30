import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { stripeCreateCheckoutSessionActivityDefinition } from "./stripe-create-checkout-session";
import { validateOrderActivityDefinition } from "./validate-order";
import { chargePaymentActivityDefinition } from "./charge-payment";
import { getPaymentStatusActivityDefinition } from "./get-payment-status";

export interface PaymentsConfig extends IntegrationModuleConfig {
  stripeSecretKey?: string;
}

export const PaymentsModule: IntegrationModule = {
  name: "payments",
  registerActivities(registry: ActivityRegistry, config: PaymentsConfig) {
    if (!config.enabled){
      return;
    }

    const defs: AnyActivityDefinition[] = [];

    defs.push(validateOrderActivityDefinition());
    defs.push(chargePaymentActivityDefinition());

    if (config.stripeSecretKey) {
      defs.push(stripeCreateCheckoutSessionActivityDefinition(config));
      defs.push(getPaymentStatusActivityDefinition(config));
    }

    for (const def of defs) {
      registry.register(def);
    }
  },
};