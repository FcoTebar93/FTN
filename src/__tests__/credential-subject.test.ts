import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCredentialSubjectFromWorkflowName,
  resolveCredentialSubject,
} from "../app/credential-subject";

test("parseCredentialSubjectFromWorkflowName extrae subject de workflows Designer", () => {
  assert.equal(parseCredentialSubjectFromWorkflowName("demo::signup-payment"), "demo");
  assert.equal(parseCredentialSubjectFromWorkflowName("tenant-a:demo::wf-1"), "tenant-a:demo");
  assert.equal(parseCredentialSubjectFromWorkflowName("payment-signup"), undefined);
});

test("resolveCredentialSubject usa fallback para catálogo global", () => {
  assert.equal(resolveCredentialSubject("payment-signup"), "system");
  assert.equal(resolveCredentialSubject("alice::mi-proceso", "system"), "alice");
});
