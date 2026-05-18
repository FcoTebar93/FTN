import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasSendgridEmailConfig,
  hasSmtpEmailConfig,
  normalizeSmtpPassword,
  resolveEmailTransportKind,
} from "../modules/integrations/notifications/email-config";
import type { NotificationsConfig } from "../modules/integrations/notifications";

test("resolveEmailTransportKind prioriza SMTP si está completo", () => {
  const config: NotificationsConfig = {
    enabled: true,
    smtpHost: "smtp.gmail.com",
    smtpUser: "a@gmail.com",
    smtpPass: "secret",
    emailFrom: "a@gmail.com",
    sendgridApiKey: "SG.test",
  };
  assert.equal(resolveEmailTransportKind(config), "smtp");
});

test("resolveEmailTransportKind usa SendGrid si no hay SMTP", () => {
  const config: NotificationsConfig = {
    enabled: true,
    sendgridApiKey: "SG.test",
    emailFrom: "dev@example.com",
  };
  assert.equal(resolveEmailTransportKind(config), "sendgrid");
  assert.equal(hasSendgridEmailConfig(config), true);
  assert.equal(hasSmtpEmailConfig(config), false);
});

test("normalizeSmtpPassword elimina espacios de contraseñas de aplicación", () => {
  assert.equal(normalizeSmtpPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
});
