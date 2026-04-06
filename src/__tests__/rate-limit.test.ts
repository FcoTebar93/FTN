import assert from "node:assert/strict";
import { test } from "node:test";

import { createRateLimiter } from "../infra/http/security";

test("createRateLimiter permite hasta N peticiones por ventana y luego bloquea", () => {
  const limit = createRateLimiter(3);
  const ip = "10.0.0.1";
  assert.equal(limit(ip), true);
  assert.equal(limit(ip), true);
  assert.equal(limit(ip), true);
  assert.equal(limit(ip), false);
});

test("createRateLimiter con límite 0 desactiva el rate limit (siempre permite)", () => {
  const limit = createRateLimiter(0);
  assert.equal(limit("a"), true);
  assert.equal(limit("a"), true);
});
