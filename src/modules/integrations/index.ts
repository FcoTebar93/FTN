import { ActivityRegistry } from "../../core/activity-registry";
import { StorageConfig, StorageModule } from "./storage";
import { DocumentsConfig, DocumentsModule } from "./documents";
import { NotificationsConfig, NotificationsModule } from "./notifications";
import { PaymentsConfig, PaymentsModule } from "./payments";
import { IdentityConfig, IdentityModule } from "./identity";
import { LogisticsConfig, LogisticsModule } from "./logistics";
import { CrmModule, type CrmConfig } from "./crm";

export interface IntegrationsConfig {
  storage: StorageConfig;
  documents: DocumentsConfig;
  notifications: NotificationsConfig;
  payments: PaymentsConfig;
  identity: IdentityConfig;
  logistics: LogisticsConfig;
  crm: CrmConfig;
}

export function registerIntegrations(registry: ActivityRegistry, config: IntegrationsConfig) {
  StorageModule.registerActivities(registry, { enabled: config.storage.enabled });
  DocumentsModule.registerActivities(registry, { enabled: config.documents.enabled });
  NotificationsModule.registerActivities(registry, { enabled: config.notifications.enabled });
  PaymentsModule.registerActivities(registry, config.payments);
  IdentityModule.registerActivities(registry, { enabled: config.identity.enabled });
  LogisticsModule.registerActivities(registry, config.logistics);
  CrmModule.registerActivities(registry, config.crm);
}

export default {
    registerIntegrations
}