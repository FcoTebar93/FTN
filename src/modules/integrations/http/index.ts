import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import type { HttpConfig } from "./types";
import { httpRequestActivityDefinition } from "./http-request";

export type { HttpConfig } from "./types";

export const HttpModule: IntegrationModule = {
  name: "http",
  registerActivities(registry: ActivityRegistry, config: HttpConfig) {
    if (!config.enabled) return;
    const defs: AnyActivityDefinition[] = [httpRequestActivityDefinition(config)];
    for (const def of defs) {
      registry.register(def);
    }
  },
};