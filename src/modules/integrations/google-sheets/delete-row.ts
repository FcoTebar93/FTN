import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { DeleteRowInput, DeleteRowResult, GoogleSheetsClient } from "./types";
import { deleteRowInputSchema } from "./activity-schemas";
import { assertActivityInput } from "./validate-input";

export function deleteRowActivityDefinition(
  client: GoogleSheetsClient
): ActivityDefinition<DeleteRowInput, DeleteRowResult> {
  return {
    name: "google_sheets.delete_row:v1",
    maxAttempts: 3,
    timeoutMs: 30_000,
    tags: ["google_sheets", "integration", "spreadsheet"],
    version: "v1",
    inputSchema: deleteRowInputSchema,
    resultSchema: {
      type: "object",
      required: ["spreadsheetId", "sheetName", "deletedRowIndex"],
      properties: {
        spreadsheetId: { type: "string" },
        sheetName: { type: "string" },
        deletedRowIndex: { type: "integer" },
      },
      additionalProperties: false,
    },
    async execute(input: DeleteRowInput, ctx: ActivityExecutionContext): Promise<DeleteRowResult> {
      assertActivityInput(deleteRowInputSchema, input);
      ctx.log("google_sheets.delete_row", {
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        rowIndex: input.rowIndex,
      });
      return client.deleteRow(input);
    },
  };
}
