import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { GoogleSheetsClient, UpdateRowInput, UpdateRowResult } from "./types";
import { updateRowInputSchema } from "./activity-schemas";
import { assertActivityInput } from "./validate-input";

export function updateRowActivityDefinition(
  client: GoogleSheetsClient
): ActivityDefinition<UpdateRowInput, UpdateRowResult> {
  return {
    name: "google_sheets.update_row:v1",
    maxAttempts: 3,
    timeoutMs: 30_000,
    tags: ["google_sheets", "integration", "spreadsheet"],
    version: "v1",
    inputSchema: updateRowInputSchema,
    resultSchema: {
      type: "object",
      required: ["spreadsheetId", "sheetName", "rowIndex", "updatedRange", "updatedCells"],
      properties: {
        spreadsheetId: { type: "string" },
        sheetName: { type: "string" },
        rowIndex: { type: "integer" },
        updatedRange: { type: "string" },
        updatedCells: { type: "integer" },
      },
      additionalProperties: false,
    },
    async execute(input: UpdateRowInput, ctx: ActivityExecutionContext): Promise<UpdateRowResult> {
      assertActivityInput(updateRowInputSchema, input);
      ctx.log("google_sheets.update_row", {
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        rowIndex: input.rowIndex,
      });
      return client.updateRow(input);
    },
  };
}
