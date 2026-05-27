import type { JsonSchema } from "../../../shared/json-schema";

export const cellValueSchema: JsonSchema = {
  description: "Valor de celda (string, número, boolean o null)",
};

export const spreadsheetTargetSchema: JsonSchema = {
  type: "object",
  required: ["spreadsheetId"],
  properties: {
    spreadsheetId: {
      type: "string",
      description: "ID del spreadsheet de Google Sheets",
    },
    sheetName: {
      type: "string",
      description: "Nombre de la pestaña (por defecto Sheet1)",
    },
  },
};

export const rowValuesSchema: JsonSchema = {
  description: "Fila como array de celdas o objeto { columna | letra: valor }",
};

export const findFilterSchema: JsonSchema = {
  type: "object",
  required: ["column", "operator", "value"],
  properties: {
    column: {
      type: "string",
      description: "Nombre de cabecera o letra de columna (A, B, ...)",
    },
    operator: {
      type: "string",
      enum: ["eq", "ne", "contains", "startsWith", "gt", "gte", "lt", "lte"],
    },
    value: cellValueSchema,
  },
  additionalProperties: false,
};
