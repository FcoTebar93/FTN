import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { AppendRowsInput, AppendRowsResult, GoogleSheetsClient } from "./types";
import { appendRowsInputSchema } from "./activity-schemas";
import { assertActivityInput } from "./validate-input";

export function appendRowsActivityDefinition(
  client: GoogleSheetsClient
): ActivityDefinition<AppendRowsInput, AppendRowsResult> {
  return {
    name: "google_sheets.append_rows:v1",
    maxAttempts: 3,
    timeoutMs: 30_000,
    tags: ["google_sheets", "integration", "spreadsheet"],
    version: "v1",
    inputSchema: appendRowsInputSchema,
    resultSchema: {
      type: "object",
      required: ["spreadsheetId", "sheetName", "updatedRange", "updatedRows"],
      properties: {
        spreadsheetId: { type: "string" },
        sheetName: { type: "string" },
        updatedRange: { type: "string" },
        updatedRows: { type: "integer" },
      },
      additionalProperties: false,
    },
    async execute(input: AppendRowsInput, ctx: ActivityExecutionContext): Promise<AppendRowsResult> {
      assertActivityInput(appendRowsInputSchema, input);
      ctx.log("google_sheets.append_rows", {
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        rowCount: input.rows.length,
      });
      return client.appendRows(input);
    },
  };
}
