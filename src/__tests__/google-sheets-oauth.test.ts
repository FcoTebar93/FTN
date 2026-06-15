import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGoogleSheetsAuthConfig,
  parseServiceAccountJson,
  resolveOAuthRefreshTokenFromSecrets,
} from "../modules/integrations/google-sheets/auth";
import {
  createGoogleSheetsOAuthState,
  verifyGoogleSheetsOAuthState,
} from "../modules/integrations/google-sheets/oauth";

test("resolveOAuthRefreshTokenFromSecrets lee refreshToken y refresh_token", () => {
  assert.equal(resolveOAuthRefreshTokenFromSecrets({ refreshToken: " rt1 " }), "rt1");
  assert.equal(resolveOAuthRefreshTokenFromSecrets({ refresh_token: "rt2" }), "rt2");
  assert.equal(resolveOAuthRefreshTokenFromSecrets({}), undefined);
});

test("buildGoogleSheetsAuthConfig prioriza OAuth cuando hay refresh token", () => {
  const auth = buildGoogleSheetsAuthConfig({
    credentialSecrets: { refreshToken: "rt-demo" },
    credentialConfig: { authType: "oauth2" },
    oauthClientId: "client-id",
    oauthClientSecret: "client-secret",
    oauthRedirectUri: "http://localhost:4000/callback",
  });
  assert.equal(auth?.kind, "oauth2");
  if (auth?.kind === "oauth2") {
    assert.equal(auth.refreshToken, "rt-demo");
  }
});

test("buildGoogleSheetsAuthConfig usa service account si no hay OAuth", () => {
  const auth = buildGoogleSheetsAuthConfig({
    credentialSecrets: {
      clientEmail: "svc@test.iam.gserviceaccount.com",
      privateKey: "key",
    },
    oauthClientId: "client-id",
    oauthClientSecret: "client-secret",
    oauthRedirectUri: "http://localhost:4000/callback",
  });
  assert.equal(auth?.kind, "service_account");
});

test("OAuth state firma y verifica subject", () => {
  const secret = "test-signing-secret";
  const state = createGoogleSheetsOAuthState("demo-user", secret);
  const verified = verifyGoogleSheetsOAuthState(state, secret);
  assert.deepEqual(verified, { subject: "demo-user" });
  assert.equal(verifyGoogleSheetsOAuthState(state, "wrong-secret"), undefined);
});

test("parseServiceAccountJson acepta JSON string y objeto", () => {
  const json = JSON.stringify({
    client_email: "svc@test.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  });
  const fromString = parseServiceAccountJson(json);
  assert.equal(fromString.client_email, "svc@test.iam.gserviceaccount.com");
  assert.ok(fromString.private_key.includes("\n"));
});
