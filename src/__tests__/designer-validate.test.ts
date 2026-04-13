import assert from "node:assert/strict";
import { test } from "node:test";

import { validateConditionalExpression, validateDesignerWorkflow } from "../app/designer-validate";
import type { StoredWorkflow } from "../app/designer-types";

test("validateConditionalExpression rechaza vacío y operadores desconocidos", () => {
  assert.equal(validateConditionalExpression(""), "La expresión condicional no puede estar vacía");
  assert.equal(
    validateConditionalExpression("input.x"),
    "Expresión no válida: se requiere un operador (===, !==, >=, <=, >, <)"
  );
  assert.equal(validateConditionalExpression("input.x === 1"), null);
});

test("validateDesignerWorkflow detecta retry con target inválido", () => {
  const w: StoredWorkflow = {
    id: "w",
    version: "v1",
    displayName: "x",
    steps: [
      { id: "a1", kind: "activity", activityName: "x", input: {} },
      { id: "r1", kind: "retry", maxAttempts: 2, targetStepId: "missing", next: null },
    ],
    entryStepId: "r1",
  };
  assert.match(validateDesignerWorkflow(w) ?? "", /no existe el paso/);
});
