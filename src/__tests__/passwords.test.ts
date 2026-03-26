import assert from "node:assert/strict";
import { test } from "node:test";

import { hashPassword, verifyPassword } from "../infra/passwords";

test("hashPassword y verifyPassword aceptan la misma contraseña", async () => {
  const h = await hashPassword("contraseña-segura-10");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await verifyPassword("contraseña-segura-10", h), true);
  assert.equal(await verifyPassword("otra", h), false);
});
