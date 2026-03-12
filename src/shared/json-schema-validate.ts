import type { JsonSchema } from "./json-schema";

export interface JsonValidationError {
  path: string;
  message: string;
}

export interface JsonValidationResult {
  valid: boolean;
  errors: JsonValidationError[];
}

export function validateJson(schema: JsonSchema | undefined, value: unknown, path = "$"): JsonValidationResult {
  const errors: JsonValidationError[] = [];
  if (!schema) {
    return { valid: true, errors };
  }

  const push = (msg: string) => errors.push({ path, message: msg });

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeof value;
    const isArray = Array.isArray(value);
    const ok =
      (types.includes("string") && t === "string") ||
      (types.includes("number") && t === "number") ||
      (types.includes("integer") && t === "number" && Number.isInteger(value as number)) ||
      (types.includes("boolean") && t === "boolean") ||
      (types.includes("object") && !isArray && t === "object" && value !== null) ||
      (types.includes("array") && isArray);

    if (!ok) {
      push(`Expected type ${types.join(" | ")}, got ${isArray ? "array" : t}`);
      return { valid: false, errors };
    }
  }

  if (schema.enum && !schema.enum.some((v) => v === value)) {
    push(`Value not in enum`);
  }

  if (schema.type === "object" && schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: "Required property missing" });
        }
      }
    }

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const child = obj[key];
      const childResult = validateJson(propSchema, child, `${path}.${key}`);
      errors.push(...childResult.errors);
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${path}.${key}`, message: "Additional property not allowed" });
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    const arr = value as unknown[];
    if (schema.minItems !== undefined && arr.length < schema.minItems) {
      push(`Array has fewer items than minItems=${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && arr.length > schema.maxItems) {
      push(`Array has more items than maxItems=${schema.maxItems}`);
    }
    arr.forEach((el, i) => {
      const childResult = validateJson(schema.items as JsonSchema, el, `${path}[${i}]`);
      errors.push(...childResult.errors);
    });
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      push(`Value < minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      push(`Value > maximum ${schema.maximum}`);
    }
  }

  if (schema.format === "email" && typeof value === "string") {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(value)) {
      push("Invalid email format");
    }
  }

  return { valid: errors.length === 0, errors };
}