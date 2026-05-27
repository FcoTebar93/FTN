import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { CreateRowInput, CreateRowResult, GoogleSheetsClient } from "./types";
import { createRowInputSchema } from "./activity-schemas";
import { assertActivityInput } from "./validate-input";

export function createRowActivityDefinition(
  client: GoogleSheetsClient
): ActivityDefinition<CreateRowInput, CreateRowResult> {
  return {
    name: "google_sheets.create_row:v1",
    maxAttempts: 3,
    timeoutMs: 30_000,
    tags: ["google_sheets", "integration", "spreadsheet"],
    version: "v1",
    inputSchema: createRowInputSchema,
    resultSchema: {
      type: "object",
      required: ["spreadsheetId", "sheetName", "rowIndex", "updatedRange"],
      properties: {
        spreadsheetId: { type: "string" },
        sheetName: { type: "string" },
        rowIndex: { type: "integer" },
        updatedRange: { type: "string" },
      },
      additionalProperties: false,
    },
    async execute(input: CreateRowInput, ctx: ActivityExecutionContext): Promise<CreateRowResult> {
      assertActivityInput(createRowInputSchema, input);
      ctx.log("google_sheets.create_row", {
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        rowIndex: input.rowIndex,
      });
      return client.createRow(input);
    },
  };
}
