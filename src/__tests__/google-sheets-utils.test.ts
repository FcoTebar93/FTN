import assert from "node:assert/strict";
import { test } from "node:test";

import { parseServiceAccountJson } from "../modules/integrations/google-sheets/auth";
import {
  filterSheetRows,
  letterToColumnIndex,
  quoteSheetName,
  rowValuesToArray,
  toA1Range,
} from "../modules/integrations/google-sheets/sheet-utils";

test("parseServiceAccountJson acepta JSON string y objeto", () => {
  const json = JSON.stringify({
    client_email: "svc@test.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  });
  const fromString = parseServiceAccountJson(json);
  assert.equal(fromString.client_email, "svc@test.iam.gserviceaccount.com");
  assert.ok(fromString.private_key.includes("\n"));

  const fromObject = parseServiceAccountJson({
    client_email: "svc@test.iam.gserviceaccount.com",
    private_key: "key",
  });
  assert.equal(fromObject.private_key, "key");
});

test("toA1Range escapa nombres de hoja con espacios", () => {
  assert.equal(toA1Range("Sheet1", "A1:B2"), "Sheet1!A1:B2");
  assert.equal(toA1Range("Hoja 1", "A1"), "'Hoja 1'!A1");
  assert.equal(quoteSheetName("Hoja's"), "'Hoja''s'");
});

test("rowValuesToArray mapea por cabecera y por letra", () => {
  const headers = ["id", "status", "amount"];
  const byHeader = rowValuesToArray({ status: "ok", amount: 10 }, headers);
  assert.deepEqual(byHeader, [null, "ok", 10]);

  const byLetter = rowValuesToArray({ A: "1", C: 5 }, headers);
  assert.deepEqual(byLetter, ["1", null, 5]);
  assert.equal(letterToColumnIndex("C"), 3);
});

test("filterSheetRows aplica filtros AND y limit", () => {
  const matrix = [
    ["id", "status"],
    ["1", "pending"],
    ["2", "done"],
    ["3", "pending"],
  ];
  const headers = ["id", "status"];
  const rows = filterSheetRows(
    matrix,
    headers,
    [{ column: "status", operator: "eq", value: "pending" }],
    { hasHeaderRow: true, limit: 1 }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowIndex, 2);
  assert.equal(rows[0].values.status, "pending");
});
