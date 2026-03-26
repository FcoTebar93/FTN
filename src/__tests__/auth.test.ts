import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";

import type { ApiSecurityConfig } from "../infra/http/api-security";
import {
  FTN_SCOPES,
  checkProtectedAccess,
  issueAccessToken,
  requiredScopesForRoute,
  signJwtHs256,
  validateLoginCredentials,
  verifyJwtHs256,
} from "../infra/http/auth";

function mockReq(headers: Record<string, string | undefined>): http.IncomingMessage {
  return { headers } as http.IncomingMessage;
}

test("verifyJwtHs256 acepta token válido y rechaza firma incorrecta", () => {
  const secret = "test-secret-min-32-chars-long!!";
  const token = signJwtHs256(
    { sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600, scope: "catalog:read workflows:read" },
    secret
  );
  const p = verifyJwtHs256(token, secret);
  assert.ok(p);
  assert.equal(p!.sub, "u1");

  const bad = verifyJwtHs256(token, "wrong-secret-min-32-chars-long");
  assert.equal(bad, null);
});

test("verifyJwtHs256 respeta iss y aud", () => {
  const secret = "x".repeat(32);
  const token = signJwtHs256(
    {
      exp: Math.floor(Date.now() / 1000) + 60,
      iss: "ftn",
      aud: "api",
    },
    secret
  );
  assert.ok(verifyJwtHs256(token, secret, { issuer: "ftn", audience: "api" }));
  assert.equal(verifyJwtHs256(token, secret, { issuer: "other" }), null);
  assert.equal(verifyJwtHs256(token, secret, { audience: "other" }), null);
});

test("requiredScopesForRoute asigna scopes esperados", () => {
  assert.deepEqual(requiredScopesForRoute("GET", "/activities"), [FTN_SCOPES.catalogRead]);
  assert.deepEqual(requiredScopesForRoute("GET", "/catalog/workflows"), [FTN_SCOPES.catalogRead]);
  assert.deepEqual(requiredScopesForRoute("GET", "/designer/kinds"), [FTN_SCOPES.designerRead]);
  assert.deepEqual(requiredScopesForRoute("POST", "/designer/workflows"), [FTN_SCOPES.designerWrite]);
  assert.deepEqual(requiredScopesForRoute("GET", "/workflows"), [FTN_SCOPES.workflowsRead]);
  assert.deepEqual(requiredScopesForRoute("POST", "/workflows/a/b/signals"), [FTN_SCOPES.workflowsWrite]);
  assert.deepEqual(requiredScopesForRoute("POST", "/pay/checkout"), [FTN_SCOPES.paymentsWrite]);
});

function baseConfig(over: Partial<ApiSecurityConfig> = {}): ApiSecurityConfig {
  return {
    corsOrigins: ["http://localhost:5173"],
    enableRbac: false,
    apiKeyScopes: ["*"],
    loginUsername: "ftn",
    jwtTtlSeconds: 3600,
    loginScopes: "*",
    rateLimitPerMinute: 0,
    maxBodyBytes: 1024,
    trustProxy: false,
    ...over,
  };
}

test("checkProtectedAccess: sin credenciales configuradas, allow", () => {
  const req = mockReq({});
  assert.equal(checkProtectedAccess(req, baseConfig(), "GET", "/workflows"), "allow");
});

test("checkProtectedAccess: health público", () => {
  const req = mockReq({});
  assert.equal(checkProtectedAccess(req, baseConfig({ apiKey: "k" }), "GET", "/health"), "allow");
});

test("RBAC: API key con scopes limitados no puede designer:write", () => {
  const req = mockReq({ authorization: "Bearer mykey" });
  const config = baseConfig({
    apiKey: "mykey",
    enableRbac: true,
    apiKeyScopes: ["catalog:read"],
  });
  assert.equal(checkProtectedAccess(req, config, "POST", "/designer/workflows"), "forbidden");
});

test("RBAC: API key con * puede designer:write", () => {
  const req = mockReq({ authorization: "Bearer mykey" });
  const config = baseConfig({
    apiKey: "mykey",
    enableRbac: true,
    apiKeyScopes: ["*"],
  });
  assert.equal(checkProtectedAccess(req, config, "POST", "/designer/workflows"), "allow");
});

test("signJwtHs256 e issueAccessToken son coherentes con verifyJwtHs256", () => {
  const secret = "y".repeat(32);
  const cfg = baseConfig({
    jwtSecret: secret,
    loginPassword: "pw",
    loginUsername: "alice",
    jwtTtlSeconds: 120,
    loginScopes: "catalog:read workflows:read",
  });
  assert.ok(validateLoginCredentials(cfg, "alice", "pw"));
  assert.equal(validateLoginCredentials(cfg, "alice", "wrong"), false);

  const { token, expiresIn } = issueAccessToken(cfg);
  assert.equal(expiresIn, 120);
  const payload = verifyJwtHs256(token, secret);
  assert.ok(payload);
  assert.equal(payload!.sub, "alice");
  assert.ok(typeof payload!.scope === "string" && payload!.scope.includes("catalog:read"));
});

test("RBAC: JWT con scope adecuado", () => {
  const secret = "jwt-secret-key-at-least-32-bytes!!";
  const token = signJwtHs256(
    {
      exp: Math.floor(Date.now() / 1000) + 120,
      scope: "designer:write",
    },
    secret
  );
  const req = mockReq({ authorization: `Bearer ${token}` });
  const config = baseConfig({
    jwtSecret: secret,
    enableRbac: true,
  });
  assert.equal(checkProtectedAccess(req, config, "POST", "/designer/workflows"), "allow");
});
