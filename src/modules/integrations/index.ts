import { ActivityRegistry } from "../../core/activity-registry";
import { StorageConfig, StorageModule } from "./storage";
import { DocumentsConfig, DocumentsModule } from "./documents";
import { NotificationsConfig, NotificationsModule } from "./notifications";
import { PaymentsConfig, PaymentsModule } from "./payments";
import { IdentityConfig, IdentityModule } from "./identity";
import { LogisticsConfig, LogisticsModule } from "./logistics";
import { CrmModule, type CrmConfig } from "./crm";
import { HttpModule, type HttpConfig } from "./http";
import { MessagingModule, type MessagingConfig } from "./messaging";

export interface IntegrationsConfig {
  storage: StorageConfig;
  documents: DocumentsConfig;
  notifications: NotificationsConfig;
  payments: PaymentsConfig;
  identity: IdentityConfig;
  logistics: LogisticsConfig;
  crm: CrmConfig;
  http: HttpConfig;
  messaging: MessagingConfig;
}

export function registerIntegrations(registry: ActivityRegistry, config: IntegrationsConfig) {
  StorageModule.registerActivities(registry, { enabled: config.storage.enabled });
  DocumentsModule.registerActivities(registry, { enabled: config.documents.enabled });
  NotificationsModule.registerActivities(registry, config.notifications);
  PaymentsModule.registerActivities(registry, config.payments);
  IdentityModule.registerActivities(registry, config.identity);
  LogisticsModule.registerActivities(registry, config.logistics);
  CrmModule.registerActivities(registry, config.crm);
  HttpModule.registerActivities(registry, config.http);
  MessagingModule.registerActivities(registry, config.messaging);
}

export default {
    registerIntegrations
}