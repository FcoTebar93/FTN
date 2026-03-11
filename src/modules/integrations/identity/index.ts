import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { verifyIdentityActivityDefinition } from "./verify-identity";

export interface IdentityConfig {
    enabled: boolean;
}

export const IdentityModule: IntegrationModule = {
    name: "identity",
    registerActivities(registry: ActivityRegistry, config: IdentityConfig) {

        if (!config.enabled){
            return;
        }

        const defs: AnyActivityDefinition[] = [verifyIdentityActivityDefinition()];

        for (const def of defs) {
            registry.register(def);
        }
    }
};