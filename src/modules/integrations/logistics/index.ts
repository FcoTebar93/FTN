import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import { createShipmentActivityDefinition } from "./create-shipment";

export interface LogisticsConfig extends IntegrationModuleConfig {}

export const LogisticsModule: IntegrationModule = {
  name: "logistics",
  registerActivities(registry: ActivityRegistry, config: LogisticsConfig) {
    if (!config.enabled) return;
    registry.register(createShipmentActivityDefinition());
  },
};
