import type { JsonSchema } from "../api/types";

function normalizeType(type?: string | string[]): string | undefined {
  if (Array.isArray(type)) {
    return type.find((t) => t !== "null") ?? type[0];
  }
  return type;
}

function isNestedPropertySchema(prop: JsonSchema): boolean {
  const t = normalizeType(prop.type);
  return t === "object" || t === "array";
}

export function isFormRenderableSchema(schema?: JsonSchema): boolean {
  if (!schema) return false;
  if (normalizeType(schema.type) !== "object") return false;
  const properties = schema.properties;
  if (!properties || Object.keys(properties).length === 0) return false;
  return !Object.values(properties).some(isNestedPropertySchema);
}

export function buildDefaultInputFromSchema(schema?: JsonSchema): Record<string, unknown> {
  if (!schema || normalizeType(schema.type) !== "object" || !schema.properties) {
    return {};
  }
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) {
      defaults[key] = prop.default;
      continue;
    }
    const t = normalizeType(prop.type);
    if (t === "number" || t === "integer") defaults[key] = prop.minimum ?? 0;
    else if (t === "boolean") defaults[key] = false;
    else if (t === "array") defaults[key] = [];
    else if (prop.enum?.length) defaults[key] = prop.enum[0];
    else defaults[key] = "";
  }
  return defaults;
}

export function mergeInputWithSchema(
  schema: JsonSchema | undefined,
  source: unknown
): Record<string, unknown> {
  const base = buildDefaultInputFromSchema(schema);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return base;
  }
  return { ...base, ...(source as Record<string, unknown>) };
}

export function validateFormInput(
  schema: JsonSchema,
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};
  const required = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};

  for (const name of required) {
    const v = values[name];
    if (v === undefined || v === null || v === "") {
      errors[name] = "required";
    }
  }

  for (const [name, prop] of Object.entries(properties)) {
    const v = values[name];
    if (v === undefined || v === null || v === "") continue;

    const t = normalizeType(prop.type);
    if ((t === "number" || t === "integer") && typeof v !== "number") {
      errors[name] = "number";
      continue;
    }
    if (t === "boolean" && typeof v !== "boolean") {
      errors[name] = "boolean";
      continue;
    }
    if (typeof v === "string" && prop.format === "email" && !v.includes("@")) {
      errors[name] = "email";
    }
    if (typeof v === "number" && typeof prop.minimum === "number" && v < prop.minimum) {
      errors[name] = "minimum";
    }
  }

  return errors;
}

export function getFieldInputType(prop: JsonSchema): "text" | "email" | "number" | "checkbox" | "select" {
  if (prop.enum && prop.enum.length > 0) return "select";
  const t = normalizeType(prop.type);
  if (t === "boolean") return "checkbox";
  if (t === "number" || t === "integer") return "number";
  if (prop.format === "email") return "email";
  return "text";
}