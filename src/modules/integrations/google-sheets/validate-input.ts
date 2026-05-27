import type { JsonSchema } from "../../../shared/json-schema";
import { validateJson } from "../../../shared/json-schema-validate";

export function assertActivityInput(schema: JsonSchema | undefined, input: unknown): void {
  const result = validateJson(schema, input);
  if (!result.valid) {
    const details = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`google_sheets: input inválido — ${details}`);
  }
}
