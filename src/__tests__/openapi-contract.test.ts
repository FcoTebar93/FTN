import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** Mismas comprobaciones estructurales que scripts/check-openapi.mjs, en forma de test CI. */
test("OpenAPI spec es JSON 3.x con paths mínimos", () => {
  const specPath = join(process.cwd(), "docs", "api", "openapi.json");
  assert.ok(existsSync(specPath), `Missing ${specPath}`);
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
  assert.ok(typeof spec.openapi === "string" && String(spec.openapi).startsWith("3."), "openapi 3.x");
  assert.ok(spec.info && typeof spec.info === "object", "info");
  const info = spec.info as { title?: string; version?: string };
  assert.ok(typeof info.title === "string" && info.title.trim(), "info.title");
  assert.ok(typeof info.version === "string" && info.version.trim(), "info.version");
  const paths = spec.paths as Record<string, unknown>;
  assert.ok(paths && typeof paths === "object", "paths");
  for (const p of [
    "/health",
    "/ready",
    "/workflows",
    "/auth/login",
    "/openapi.json",
    "/designer/workflows/{id}/test-run",
    "/activities",
    "/credentials",
  ]) {
    assert.ok(p in paths, `missing path ${p}`);
  }
  const testRun = paths["/designer/workflows/{id}/test-run"] as { post?: unknown };
  assert.ok(testRun?.post, "test-run debe documentar POST");
});
