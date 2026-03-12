import type { WorkflowDefinition } from "../core/ftn";
import type { StoredWorkflow, WorkflowStep } from "./designer-types";

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
      }

      currentId = step.next ?? null;
    }

    return {
      input,
      steps: ctx.stepResults,
    };
  };
}