import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { stripeCreateCheckoutSessionActivityDefinition } from "./stripe-create-checkout-session";
import { validateOrderActivityDefinition } from "./validate-order";
import { chargePaymentActivityDefinition } from "./charge-payment";
import { getPaymentStatusActivityDefinition } from "./get-payment-status";

export interface PaymentsConfig {
  enabled: boolean;
  stripeSecretKey?: string;
}

export const PaymentsModule: IntegrationModule = {
  name: "payments",
  registerActivities(registry: ActivityRegistry, config: PaymentsConfig) {
    if (!config.enabled){
      return;
    }

    const defs: AnyActivityDefinition[] = [];

    if (config.enabled) {
      defs.push(validateOrderActivityDefinition());
      defs.push(chargePaymentActivityDefinition());
    }

    if (config.stripeSecretKey) {
      defs.push(stripeCreateCheckoutSessionActivityDefinition(config));
      defs.push(getPaymentStatusActivityDefinition(config));
    }

    for (const def of defs) {
      registry.register(def);
    }
  },
};