import type { IntegrationModule } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { ActivityDefinition, AnyActivityDefinition } from "../../../core/activities";
import { generateQrCodeActivityDefinition } from "./generate-qr-code";

export interface DocumentsConfig {
    enabled: boolean;
}

export const DocumentsModule: IntegrationModule = {
    name: "documents",
    registerActivities(registry: ActivityRegistry, config: DocumentsConfig) {
      if (!config.enabled) {
        return;
      }
      const defs: AnyActivityDefinition[] = [
        generateQrCodeActivityDefinition()
      ];
      for (const def of defs) {
        registry.register(def);
      }
    },
  };