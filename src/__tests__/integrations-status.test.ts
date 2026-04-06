import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIntegrationsStatusForSubject } from "../infra/integrations-status";

test("buildIntegrationsStatusForSubject detecta configuración desde env", async () => {
  const items = await buildIntegrationsStatusForSubject("demo", {
    hasPostgres: true,
    hasRedis: false,
    getCredential: async () => undefined,
    env: {
      STRIPE_SECRET_KEY: "sk_test_example",
      SENDGRID_API_KEY: "SG.x.y",
      EMAIL_FROM: "dev@example.com",
    } as NodeJS.ProcessEnv,
  });

  const stripe = items.find((i) => i.key === "stripe");
  const notifications = items.find((i) => i.key === "notifications");
  const postgres = items.find((i) => i.key === "postgres");
  const redis = items.find((i) => i.key === "redis");

  assert.ok(stripe);
  assert.equal(stripe!.configured, true);
  assert.equal(stripe!.source, "env");

  assert.ok(notifications);
  assert.equal(notifications!.configured, true);
  assert.equal(notifications!.source, "env");

  assert.equal(postgres?.configured, true);
  assert.equal(redis?.configured, false);
});

test("buildIntegrationsStatusForSubject detecta configuración desde credenciales", async () => {
  const items = await buildIntegrationsStatusForSubject("demo", {
    hasPostgres: false,
    hasRedis: true,
    getCredential: async (_subject, provider) => {
      if (provider === "stripe") {
        return { secrets: { stripeSecretKey: "sk_live_123" } };
      }
      if (provider === "twilio") {
        return { secrets: { accountSid: "AC1234567890", authToken: "abcdefghijk" }, config: { fromNumber: "+34123456789" } };
      }
      return undefined;
    },
    env: {} as NodeJS.ProcessEnv,
  });

  const stripe = items.find((i) => i.key === "stripe");
  const twilio = items.find((i) => i.key === "twilio");
  const redis = items.find((i) => i.key === "redis");

  assert.equal(stripe?.configured, true);
  assert.equal(stripe?.source, "credentials");
  assert.equal(twilio?.configured, true);
  assert.equal(twilio?.source, "credentials");
  assert.equal(redis?.configured, true);
});
