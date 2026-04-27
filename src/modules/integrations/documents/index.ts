import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import { generateQrCodeActivityDefinition } from "./generate-qr-code";
import { renderPdfFromTemplateActivityDefinition } from "./render-pdf-from-template";
import { registerDefinitions } from "../helpers";

export type DocumentsConfig = IntegrationModuleConfig;

export const DocumentsModule: IntegrationModule = {
  name: "documents",
  registerActivities(registry: ActivityRegistry, config: DocumentsConfig) {
    if (!config.enabled) return;
    registerDefinitions(registry, [
      generateQrCodeActivityDefinition(),
      renderPdfFromTemplateActivityDefinition(),
    ]);
  },
};