export interface DesignerExecutionContext {
  input: unknown;
  stepResults: Record<string, unknown>;
}

function getByPath(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveTemplateString(raw: string, ctx: DesignerExecutionContext): string {
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

export function resolveTemplatesInValue(value: unknown, ctx: DesignerExecutionContext): unknown {
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

function getValueFromPath(path: string, ctx: DesignerExecutionContext): unknown {
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

export function evalCondition(expression: string, ctx: DesignerExecutionContext): boolean {
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
