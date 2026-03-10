import type { ActivityRegistry } from "../../core/activity-registry";

export interface IntegrationModuleConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface IntegrationModule {
  name: string;
  registerActivities(registry: ActivityRegistry, config: IntegrationModuleConfig): void;
}