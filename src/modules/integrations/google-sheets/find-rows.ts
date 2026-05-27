import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { FindRowsInput, FindRowsResult, GoogleSheetsClient } from "./types";
import { findRowsInputSchema } from "./activity-schemas";
import { assertActivityInput } from "./validate-input";

export function findRowsActivityDefinition(
  client: GoogleSheetsClient
): ActivityDefinition<FindRowsInput, FindRowsResult> {
  return {
    name: "google_sheets.find_rows:v1",
    maxAttempts: 3,
    timeoutMs: 60_000,
    tags: ["google_sheets", "integration", "spreadsheet"],
    version: "v1",
    inputSchema: findRowsInputSchema,
    resultSchema: {
      type: "object",
      required: ["spreadsheetId", "sheetName", "headers", "rows", "totalMatched"],
      properties: {
        spreadsheetId: { type: "string" },
        sheetName: { type: "string" },
        headers: { type: "array", items: { type: "string" } },
        rows: {
          type: "array",
          items: {
            type: "object",
            required: ["rowIndex", "values"],
            properties: {
              rowIndex: { type: "integer" },
              values: { type: "object", additionalProperties: true },
            },
            additionalProperties: false,
          },
        },
        totalMatched: { type: "integer" },
      },
      additionalProperties: false,
    },
    async execute(input: FindRowsInput, ctx: ActivityExecutionContext): Promise<FindRowsResult> {
      assertActivityInput(findRowsInputSchema, input);
      ctx.log("google_sheets.find_rows", {
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        filterCount: input.filters?.length ?? 0,
      });
      return client.findRows(input);
    },
  };
}
