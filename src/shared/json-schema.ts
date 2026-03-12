export type JsonPrimitiveType = "string" | "number" | "integer" | "boolean" | "object" | "array";

export interface JsonSchema {
  type?: JsonPrimitiveType | JsonPrimitiveType[];
  title?: string;
  description?: string;
  enum?: unknown[];

  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;

  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;

  format?: string;
  minimum?: number;
  maximum?: number;

  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
}