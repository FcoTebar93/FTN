import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { HttpConfig } from "./types";
import { httpRequestActivityDefinition } from "./request";
import { registerDefinitions } from "../helpers";

export type { HttpConfig } from "./types";

export const HttpModule: IntegrationModule = {
  name: "http",
  registerActivities(registry: ActivityRegistry, config: HttpConfig) {
    if (!config.enabled) return;
    registerDefinitions(registry, [httpRequestActivityDefinition(config)]);
  },
};