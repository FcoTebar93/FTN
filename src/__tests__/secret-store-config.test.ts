import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAppConfig } from "../infra/config";
import { buildSecretStore } from "../infra/secret-store";

test("loadAppConfig usa encrypted por defecto para SecretStore", () => {
  const config = loadAppConfig({});
  assert.equal(config.secretStoreBackend, "encrypted");
});

test("loadAppConfig permite backend vault", () => {
  const config = loadAppConfig({ FTN_SECRET_STORE_BACKEND: "vault" });
  assert.equal(config.secretStoreBackend, "vault");
});

test("buildSecretStore con vault falla si falta dirección/token", () => {
  assert.throws(
    () =>
      buildSecretStore({
        backend: "vault",
        vaultMount: "secret",
        vaultPathPrefix: "ftn/credentials",
        vaultTimeoutMs: 5000,
      }),
    /Falta FTN_VAULT_ADDR/
  );
  assert.throws(
    () =>
      buildSecretStore({
        backend: "vault",
        vaultAddress: "http://127.0.0.1:8200",
        vaultMount: "secret",
        vaultPathPrefix: "ftn/credentials",
        vaultTimeoutMs: 5000,
      }),
    /Falta FTN_VAULT_TOKEN/
  );
});

test("buildSecretStore permite backend encrypted sin Vault", () => {
  const store = buildSecretStore({
    backend: "encrypted",
    vaultMount: "secret",
    vaultPathPrefix: "ftn/credentials",
    vaultTimeoutMs: 5000,
  });
  assert.equal(typeof store.save, "function");
});
