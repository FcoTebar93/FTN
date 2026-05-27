import type { JsonSchema } from "../../../shared/json-schema";
import { cellValueSchema, findFilterSchema, rowValuesSchema } from "./schemas";

const spreadsheetIdProperty: JsonSchema = {
  type: "string",
  description: "ID del spreadsheet de Google Sheets",
};

const sheetNameProperty: JsonSchema = {
  type: "string",
  description: "Nombre de la pestaña (por defecto Sheet1)",
};

export const appendRowsInputSchema: JsonSchema = {
  type: "object",
  required: ["spreadsheetId", "rows"],
  properties: {
    spreadsheetId: spreadsheetIdProperty,
    sheetName: sheetNameProperty,
    rows: {
      type: "array",
      minItems: 1,
      items: {
        type: "array",
        items: cellValueSchema,
      },
      description: "Filas a añadir al final de la hoja",
    },
    valueInputOption: {
      type: "string",
      enum: ["RAW", "USER_ENTERED"],
    },
  },
  additionalProperties: false,
};

export const createRowInputSchema: JsonSchema = {
  type: "object",
  required: ["spreadsheetId", "values"],
  properties: {
    spreadsheetId: spreadsheetIdProperty,
    sheetName: sheetNameProperty,
    rowIndex: {
      type: "integer",
      minimum: 1,
      description: "Fila 1-based donde insertar. Si se omite, se hace append.",
    },
    values: rowValuesSchema,
  },
  additionalProperties: false,
};

export const updateRowInputSchema: JsonSchema = {
  type: "object",
  required: ["spreadsheetId", "rowIndex", "values"],
  properties: {
    spreadsheetId: spreadsheetIdProperty,
    sheetName: sheetNameProperty,
    rowIndex: { type: "integer", minimum: 1, description: "Fila 1-based a actualizar" },
    values: rowValuesSchema,
    valueInputOption: {
      type: "string",
      enum: ["RAW", "USER_ENTERED"],
    },
  },
  additionalProperties: false,
};

export const deleteRowInputSchema: JsonSchema = {
  type: "object",
  required: ["spreadsheetId", "rowIndex"],
  properties: {
    spreadsheetId: spreadsheetIdProperty,
    sheetName: sheetNameProperty,
    rowIndex: { type: "integer", minimum: 1, description: "Fila 1-based a eliminar" },
  },
  additionalProperties: false,
};

export const findRowsInputSchema: JsonSchema = {
  type: "object",
  required: ["spreadsheetId"],
  properties: {
    spreadsheetId: spreadsheetIdProperty,
    sheetName: sheetNameProperty,
    filters: {
      type: "array",
      items: findFilterSchema,
      description: "Filtros AND sobre filas de datos (excluye cabecera)",
    },
    limit: { type: "integer", minimum: 1, description: "Máximo de filas devueltas" },
    hasHeaderRow: {
      type: "boolean",
      description: "Si la primera fila contiene cabeceras (por defecto true)",
    },
  },
  additionalProperties: false,
};
