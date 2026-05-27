import type { ActivityRegistry } from "../../core/activity-registry";
import { StorageModule, type StorageConfig } from "./storage";
import { DocumentsModule, type DocumentsConfig } from "./documents";
import { NotificationsModule, type NotificationsConfig } from "./notifications";
import { PaymentsModule, type PaymentsConfig } from "./payments";
import { IdentityModule, type IdentityConfig } from "./identity";
import { LogisticsModule, type LogisticsConfig } from "./logistics";
import { CrmModule, type CrmConfig } from "./crm";
import { HttpModule, type HttpConfig } from "./http";
import { MessagingModule, type MessagingConfig } from "./messaging";
import { GoogleSheetsModule, type GoogleSheetsConfig } from "./google-sheets";

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
  googleSheets: GoogleSheetsConfig;
}

export function registerIntegrations(registry: ActivityRegistry, config: IntegrationsConfig) {
  StorageModule.registerActivities(registry, config.storage);
  DocumentsModule.registerActivities(registry, config.documents);
  NotificationsModule.registerActivities(registry, config.notifications);
  PaymentsModule.registerActivities(registry, config.payments);
  IdentityModule.registerActivities(registry, config.identity);
  LogisticsModule.registerActivities(registry, config.logistics);
  CrmModule.registerActivities(registry, config.crm);
  HttpModule.registerActivities(registry, config.http);
  MessagingModule.registerActivities(registry, config.messaging);
  GoogleSheetsModule.registerActivities(registry, config.googleSheets);
}