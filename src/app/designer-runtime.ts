import type { WorkflowDefinition } from "../core/ftn";
import type { ActivityStep, ConditionalStep, ParallelStep, RetryStep, StoredWorkflow, WorkflowStep } from "./designer-types";

interface ExecutionContext {
  input: any;
  stepResults: Record<string, unknown>;
}

function findStep(stored: StoredWorkflow, id: string): WorkflowStep {
  const step = stored.steps.find((s) => s.id === id);
  if (!step) {
    throw new Error(`Step "${id}" not found in workflow "${stored.id}"`);
  }
  return step;
}

function getByPath(root: any, path: string): unknown {
    const parts = path.split(".").filter(Boolean);
    let current: any = root;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
}
  
function resolveTemplateString(raw: string, ctx: ExecutionContext): string {
    if (!raw.includes("{{")) return raw;
  
    return raw.replace(/{{\s*([^}]+)\s*}}/g, (_, expr: string) => {
      const trimmed = expr.trim();
      let value: unknown;
  
      if (trimmed.startsWith("input.")) {
        value = getByPath(ctx.input, trimmed.slice("input.".length));
      } else if (trimmed.startsWith("steps.")) {
        const rest = trimmed.slice("steps.".length);
        const [stepId, ...pathParts] = rest.split(".");
        const stepResult = ctx.stepResults[stepId];
        value = pathParts.length > 0 ? getByPath(stepResult, pathParts.join(".")) : stepResult;
      } else {
        return `{{${expr}}}`;
      }
  
      if (value == null) return "";
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    });
}
  
function resolveTemplatesInValue(value: unknown, ctx: ExecutionContext): unknown {
    if (typeof value === "string") {
      return resolveTemplateString(value, ctx);
    }
    if (Array.isArray(value)) {
      return value.map((item) => resolveTemplatesInValue(item, ctx));
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = resolveTemplatesInValue(v, ctx);
      }
      return result;
    }
    return value;
}

export function buildWorkflowDefinitionFromStored(
  stored: StoredWorkflow
): WorkflowDefinition<any, any> {
  return async (ftn, input) => {
    const ctx: ExecutionContext = {
      input,
      stepResults: {},
    };

    let currentId: string | null = stored.entryStepId;

    while (currentId) {
      const step = findStep(stored, currentId);

      if (step.kind === "activity") {
        const resolvedInput = resolveTemplatesInValue(step.input, ctx);
        const handle = ftn.activity<any, any>(step.activityName, resolvedInput);
        const [result] = await ftn.join([handle]);
        ctx.stepResults[step.id] = result;
      } else if (step.kind === "sleep") {
        await ftn.sleep(step.milliseconds);
        ctx.stepResults[step.id] = true;
      } else if (step.kind === "signal") {
        const signalData = await ftn.signal<any>(step.signalName);
        ctx.stepResults[step.id] = signalData;
      } else if (step.kind === "conditional") {
        const cond = (step as ConditionalStep);
        const ok = evalCondition(cond.expression, ctx);
        currentId = ok ? cond.thenNext ?? null : cond.elseNext ?? null;
        continue;
      } else if (step.kind === "retry") {
        const r = step as RetryStep;
        const target = findStep(stored, r.targetStepId);
        if (target.kind !== "activity") {
          throw new Error(`Retry step "${step.id}" target "${r.targetStepId}" must be an activity step`);
        }
        const act = target as ActivityStep;
        const resolvedInput = resolveTemplatesInValue(act.input, ctx);
        const result = await ftn.retry(
          { maxAttempts: Math.max(1, r.maxAttempts), backOffMs: r.backOffMs },
          async () => {
            const h = ftn.activity<any, any>(act.activityName, resolvedInput);
            const [out] = await ftn.join([h]);
            return out;
          }
        );
        ctx.stepResults[step.id] = result;
        ctx.stepResults[r.targetStepId] = result;
      } else if (step.kind === "parallel") {
        const p = step as ParallelStep;
      
        const branchActivityHandles: Promise<any>[] = [];
      
        for (const branch of p.branches) {
          for (const stepId of branch) {
            const targetStep = findStep(stored, stepId);
            if (targetStep.kind !== "activity") continue;
            const resolvedBranchInput = resolveTemplatesInValue((targetStep as ActivityStep).input ?? {}, ctx);
            const handle = ftn.activity<any, any>((targetStep as ActivityStep).activityName, resolvedBranchInput);
            branchActivityHandles.push(ftn.join([handle]).then(([r]) => {
              ctx.stepResults[stepId] = r;
            }));
          }
        }
      
        if (branchActivityHandles.length > 0) {
          await Promise.all(branchActivityHandles);
        }
      
        currentId = step.next ?? null;
        continue;
      }

      currentId = step.next ?? null;
    }

    return {
      input,
      steps: ctx.stepResults,
    };
  };
}

function parseLiteral(text: string): unknown {
  const trimmed = text.trim();

  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  const num = Number(trimmed);
  if (!Number.isNaN(num)) return num;

  return trimmed;
}

function getValueFromPath(path: string, ctx: ExecutionContext): unknown {
  const trimmed = path.trim();
  if (trimmed.startsWith("input.")) {
    return getByPath(ctx.input, trimmed.slice("input.".length));
  }
  if (trimmed.startsWith("steps.")) {
    const rest = trimmed.slice("steps.".length);
    const [stepId, ...parts] = rest.split(".");
    const base = ctx.stepResults[stepId];
    return parts.length > 0 ? getByPath(base, parts.join(".")) : base;
  }
  return parseLiteral(trimmed);
}

function evalCondition(expression: string, ctx: ExecutionContext): boolean {
  const expr = expression.trim();
  if (!expr) return false;

  const operators = ["===", "!==", ">=", "<=", ">", "<"];
  let op: string | undefined;
  let leftRaw = "";
  let rightRaw = "";

  for (const candidate of operators) {
    const idx = expr.indexOf(candidate);
    if (idx !== -1) {
      op = candidate;
      leftRaw = expr.slice(0, idx);
      rightRaw = expr.slice(idx + candidate.length);
      break;
    }
  }

  if (!op) {
    return false;
  }

  const left = getValueFromPath(leftRaw, ctx);
  const right = parseLiteral(rightRaw);

  switch (op) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
    default:
      return false;
  }
}
