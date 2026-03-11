import type { IntegrationModule, IntegrationModuleConfig } from "./types";
import { ActivityRegistry } from "../../core/activity-registry";
import { StorageConfig, StorageModule } from "./storage";
import { DocumentsConfig, DocumentsModule } from "./documents";
import { NotificationsConfig, NotificationsModule } from "./notifications";
import { PaymentsConfig, PaymentsModule } from "./payments";

export interface IntegrationsConfig {
    storage: StorageConfig;
    documents: DocumentsConfig;
    notifications: NotificationsConfig;
    payments: PaymentsConfig;
}

export function registerIntegrations(registry: ActivityRegistry, config: IntegrationsConfig) {
    StorageModule.registerActivities(registry, { enabled: config.storage.enabled });
    DocumentsModule.registerActivities(registry, { enabled: config.documents.enabled });
    NotificationsModule.registerActivities(registry, { enabled: config.notifications.enabled });
    PaymentsModule.registerActivities(registry, { enabled: config.payments.enabled });
}

export default {
    registerIntegrations
}