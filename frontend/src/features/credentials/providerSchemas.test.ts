import { describe, expect, it } from "vitest";
import { PROVIDER_SCHEMAS, countMissingRequiredFields, getFieldErrors, credentialsPathForIntegration } from "./providerSchemas";

describe("credentials provider schemas", () => {
  it("valida formato de stripeSecretKey", () => {
    const stripe = PROVIDER_SCHEMAS.stripe;
    expect(getFieldErrors(stripe, { stripeSecretKey: "abc" }).stripeSecretKey).toContain("sk_test_");
    expect(getFieldErrors(stripe, { stripeSecretKey: "sk_test_123" }).stripeSecretKey).toBeUndefined();
  });

  it("exige campos obligatorios de twilio", () => {
    const twilio = PROVIDER_SCHEMAS.twilio;
    const values = { accountSid: "", authToken: "", fromNumber: "" };
    expect(countMissingRequiredFields(twilio, values)).toBe(3);
    const errors = getFieldErrors(twilio, values);
    expect(errors.accountSid).toBeDefined();
    expect(errors.authToken).toBeDefined();
    expect(errors.fromNumber).toBeDefined();
  });

  it("notifications permite Slack sin SendGrid", () => {
    const notifications = PROVIDER_SCHEMAS.notifications;
    const errors = getFieldErrors(notifications, {
      sendgridApiKey: "",
      emailFrom: "",
      slackWebhookUrl: "https://hooks.slack.com/services/a/b/c",
    });
    expect(errors.sendgridApiKey).toBeUndefined();
    expect(errors.slackWebhookUrl).toBeUndefined();
  });

  it("notifications exige al menos un canal", () => {
    const notifications = PROVIDER_SCHEMAS.notifications;
    const errors = getFieldErrors(notifications, {
      sendgridApiKey: "",
      emailFrom: "",
      slackWebhookUrl: "",
    });
    expect(errors.sendgridApiKey).toBeDefined();
  });

  it("incluye schema de google_sheets con OAuth", () => {
    const gs = PROVIDER_SCHEMAS.google_sheets;
    expect(gs.title).toBe("Google Sheets");
    expect(gs.oauthConnect).toBe(true);
  });

  it("valida URL en KYC", () => {
    const kyc = PROVIDER_SCHEMAS.kyc;
    expect(getFieldErrors(kyc, { providerUrl: "foo", providerToken: "x" }).providerUrl).toContain("URL");
    expect(getFieldErrors(kyc, { providerUrl: "https://kyc.local", providerToken: "x" }).providerUrl).toBeUndefined();
  });

  it("credentialsPathForIntegration enlaza google_sheets", () => {
    expect(credentialsPathForIntegration("google_sheets")).toBe("/credentials?provider=google_sheets");
    expect(credentialsPathForIntegration("postgres")).toBeUndefined();
  });
});
