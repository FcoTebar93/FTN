import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpUrl } from "../modules/integrations/http/url-policy";

test("permite URL https pública", () => {
  const u = assertPublicHttpUrl("https://example.com/path?q=1", false);
  assert.equal(u.hostname, "example.com");
});

test("bloquea localhost sin allowPrivate", () => {
  assert.throws(() => assertPublicHttpUrl("http://localhost:8080/x", false), /no permitida/);
});

test("permite localhost con allowPrivate", () => {
  const u = assertPublicHttpUrl("http://127.0.0.1:3000/", true);
  assert.equal(u.hostname, "127.0.0.1");
});

test("rechaza protocolo file", () => {
  assert.throws(() => assertPublicHttpUrl("file:///etc/passwd", false), /http/);
});
