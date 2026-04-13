import type { ConditionalStep, RetryStep, StoredWorkflow, WorkflowStep } from "./designer-types";

const CONDITION_OPERATORS = ["===", "!==", ">=", "<=", ">", "<"] as const;

/** Comprueba que la expresión del conditional use un operador soportado por el runtime (mismo subconjunto que evalCondition). */
export function validateConditionalExpression(expression: string): string | null {
  const expr = expression.trim();
  if (!expr) {
    return "La expresión condicional no puede estar vacía";
  }
  for (const candidate of CONDITION_OPERATORS) {
    if (expr.includes(candidate)) {
      return null;
    }
  }
  return `Expresión no válida: se requiere un operador (${CONDITION_OPERATORS.join(", ")})`;
}

function findStep(stored: StoredWorkflow, id: string): WorkflowStep | undefined {
  return stored.steps.find((s) => s.id === id);
}

/** Validaciones de grafo y expresiones antes de persistir un workflow del designer. */
export function validateDesignerWorkflow(w: StoredWorkflow): string | null {
  const ids = new Set(w.steps.map((s) => s.id));
  if (!ids.has(w.entryStepId)) {
    return `entryStepId "${w.entryStepId}" no coincide con ningún paso`;
  }

  for (const step of w.steps) {
    if (step.kind === "conditional") {
      const c = step as ConditionalStep;
      const err = validateConditionalExpression(c.expression);
      if (err) return err;
      if (c.thenNext && !ids.has(c.thenNext)) {
        return `Conditional "${step.id}": thenNext "${c.thenNext}" no existe`;
      }
      if (c.elseNext && !ids.has(c.elseNext)) {
        return `Conditional "${step.id}": elseNext "${c.elseNext}" no existe`;
      }
    }
    if (step.kind === "retry") {
      const r = step as RetryStep;
      if (!Number.isFinite(r.maxAttempts) || r.maxAttempts < 1 || r.maxAttempts > 50) {
        return `Retry "${step.id}": maxAttempts debe estar entre 1 y 50`;
      }
      if (!r.targetStepId?.trim()) {
        return `Retry "${step.id}": targetStepId es obligatorio`;
      }
      const target = findStep(w, r.targetStepId);
      if (!target) {
        return `Retry "${step.id}": no existe el paso "${r.targetStepId}"`;
      }
      if (target.kind !== "activity") {
        return `Retry "${step.id}": el objetivo debe ser un paso activity`;
      }
    }
    if (step.kind === "parallel") {
      for (const branch of step.branches) {
        for (const sid of branch) {
          if (!ids.has(sid)) {
            return `Parallel "${step.id}": id de paso desconocido "${sid}"`;
          }
        }
      }
    }
  }

  return null;
}
