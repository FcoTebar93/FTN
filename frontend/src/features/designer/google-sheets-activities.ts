export const GOOGLE_SHEETS_MODULE = "google_sheets";

export const GOOGLE_SHEETS_ACTIVITIES = {
  appendRows: "google_sheets.append_rows:v1",
  createRow: "google_sheets.create_row:v1",
  updateRow: "google_sheets.update_row:v1",
  deleteRow: "google_sheets.delete_row:v1",
  findRows: "google_sheets.find_rows:v1",
} as const;

export type GoogleSheetsCrudPreset = keyof typeof GOOGLE_SHEETS_ACTIVITIES;

export function isGoogleSheetsActivity(activityName?: string): boolean {
  return Boolean(activityName?.startsWith(`${GOOGLE_SHEETS_MODULE}.`));
}

export function googleSheetsActivityLabel(activityName: string): GoogleSheetsCrudPreset | undefined {
  const entry = Object.entries(GOOGLE_SHEETS_ACTIVITIES).find(([, name]) => name === activityName);
  return entry ? (entry[0] as GoogleSheetsCrudPreset) : undefined;
}

export function defaultGoogleSheetsInput(activityName: string): Record<string, unknown> {
  const base = {
    spreadsheetId: "",
    sheetName: "Hoja 1",
  };

  switch (activityName) {
    case GOOGLE_SHEETS_ACTIVITIES.appendRows:
      return {
        ...base,
        rows: [["id", "status", "amount"]],
        valueInputOption: "USER_ENTERED",
      };
    case GOOGLE_SHEETS_ACTIVITIES.createRow:
      return {
        ...base,
        values: { status: "pending", amount: 0 },
      };
    case GOOGLE_SHEETS_ACTIVITIES.updateRow:
      return {
        ...base,
        rowIndex: 2,
        values: { status: "done" },
        valueInputOption: "USER_ENTERED",
      };
    case GOOGLE_SHEETS_ACTIVITIES.deleteRow:
      return {
        ...base,
        rowIndex: 2,
      };
    case GOOGLE_SHEETS_ACTIVITIES.findRows:
      return {
        ...base,
        filters: [{ column: "status", operator: "eq", value: "pending" }],
        limit: 10,
        hasHeaderRow: true,
      };
    default:
      return base;
  }
}

export const GOOGLE_SHEETS_CRUD_PRESETS: Array<{
  preset: GoogleSheetsCrudPreset;
  labelKey: "appendRows" | "createRow" | "findRows" | "updateRow" | "deleteRow";
  stepNameKey: "appendRowsStep" | "createRowStep" | "findRowsStep" | "updateRowStep" | "deleteRowStep";
}> = [
  { preset: "findRows", labelKey: "findRows", stepNameKey: "findRowsStep" },
  { preset: "appendRows", labelKey: "appendRows", stepNameKey: "appendRowsStep" },
  { preset: "createRow", labelKey: "createRow", stepNameKey: "createRowStep" },
  { preset: "updateRow", labelKey: "updateRow", stepNameKey: "updateRowStep" },
  { preset: "deleteRow", labelKey: "deleteRow", stepNameKey: "deleteRowStep" },
];
