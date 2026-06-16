import { describe, expect, it } from "vitest";
import {
  GOOGLE_SHEETS_ACTIVITIES,
  defaultGoogleSheetsInput,
  isGoogleSheetsActivity,
} from "./google-sheets-activities";

describe("google sheets designer helpers", () => {
  it("detecta actividades google_sheets", () => {
    expect(isGoogleSheetsActivity("google_sheets.find_rows:v1")).toBe(true);
    expect(isGoogleSheetsActivity("crm.upsertUser:v1")).toBe(false);
  });

  it("genera defaults por operación CRUD", () => {
    const find = defaultGoogleSheetsInput(GOOGLE_SHEETS_ACTIVITIES.findRows);
    expect(find).toMatchObject({ spreadsheetId: "", sheetName: "Hoja 1" });
    expect(Array.isArray(find.filters)).toBe(true);

    const append = defaultGoogleSheetsInput(GOOGLE_SHEETS_ACTIVITIES.appendRows);
    expect(Array.isArray(append.rows)).toBe(true);

    const del = defaultGoogleSheetsInput(GOOGLE_SHEETS_ACTIVITIES.deleteRow);
    expect(del.rowIndex).toBe(2);
  });
});
