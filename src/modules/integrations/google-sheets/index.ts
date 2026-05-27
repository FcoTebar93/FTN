import type { IntegrationModule, IntegrationModuleConfig } from "../types";
import type { ActivityRegistry } from "../../../core/activity-registry";
import type { AnyActivityDefinition } from "../../../core/activities";
import { registerDefinitions } from "../helpers";
import { createGoogleSheetsClient } from "./client";
import type { GoogleSheetsAuthConfig } from "./types";
import { appendRowsActivityDefinition } from "./append-rows";
import { createRowActivityDefinition } from "./create-row";
import { updateRowActivityDefinition } from "./update-row";
import { deleteRowActivityDefinition } from "./delete-row";
import { findRowsActivityDefinition } from "./find-rows";

export interface GoogleSheetsConfig extends IntegrationModuleConfig {
  auth?: GoogleSheetsAuthConfig;
}

export const GoogleSheetsModule: IntegrationModule = {
  name: "google_sheets",
  registerActivities(registry: ActivityRegistry, config: GoogleSheetsConfig) {
    if (!config.enabled || !config.auth) {
      return;
    }

    const client = createGoogleSheetsClient(config.auth);
    const defs: AnyActivityDefinition[] = [
      appendRowsActivityDefinition(client),
      createRowActivityDefinition(client),
      updateRowActivityDefinition(client),
      deleteRowActivityDefinition(client),
      findRowsActivityDefinition(client),
    ];

    registerDefinitions(registry, defs);
  },
};
