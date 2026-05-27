import { google } from "googleapis";
import { JWT } from "google-auth-library";
import type { sheets_v4 } from "googleapis";
import type {
  AppendRowsInput,
  AppendRowsResult,
  CreateRowInput,
  CreateRowResult,
  DeleteRowInput,
  DeleteRowResult,
  FindRowsInput,
  FindRowsResult,
  GoogleSheetsAuthConfig,
  GoogleSheetsClient,
  SheetCellValue,
  UpdateRowInput,
  UpdateRowResult,
} from "./types";
import { toGoogleSheetsError } from "./errors";
import {
  columnIndexToLetter,
  extractHeaders,
  filterSheetRows,
  normalizeSheetName,
  rowValuesToArray,
  toA1Range,
} from "./sheet-utils";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function createGoogleSheetsClient(auth: GoogleSheetsAuthConfig): GoogleSheetsClient {
  const jwt = new JWT({
    email: auth.serviceAccount.client_email,
    key: auth.serviceAccount.private_key,
    scopes: [SHEETS_SCOPE],
    subject: auth.impersonateEmail,
  });
  const api = google.sheets({ version: "v4", auth: jwt });
  return new GoogleSheetsApiClient(api);
}

class GoogleSheetsApiClient implements GoogleSheetsClient {
  private readonly sheetIdCache = new Map<string, Map<string, number>>();

  constructor(private readonly sheets: sheets_v4.Sheets) {}

  async appendRows(input: AppendRowsInput): Promise<AppendRowsResult> {
    const sheetName = normalizeSheetName(input.sheetName);
    const range = toA1Range(sheetName, "A1");
    try {
      const res = await this.sheets.spreadsheets.values.append({
        spreadsheetId: input.spreadsheetId,
        range,
        valueInputOption: input.valueInputOption ?? "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: input.rows,
        },
      });
      const updates = res.data.updates;
      return {
        spreadsheetId: input.spreadsheetId,
        sheetName,
        updatedRange: updates?.updatedRange ?? range,
        updatedRows: updates?.updatedRows ?? input.rows.length,
      };
    } catch (err) {
      throw toGoogleSheetsError(err);
    }
  }

  async createRow(input: CreateRowInput): Promise<CreateRowResult> {
    if (input.rowIndex === undefined) {
      const appended = await this.appendRows({
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        rows: [await this.resolveRowValues(input)],
      });
      const rowIndex = this.parseRowIndexFromUpdatedRange(appended.updatedRange) ?? 0;
      return {
        spreadsheetId: input.spreadsheetId,
        sheetName: appended.sheetName,
        rowIndex,
        updatedRange: appended.updatedRange,
      };
    }

    const sheetName = normalizeSheetName(input.sheetName);
    const rowIndex = input.rowIndex;
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error("google_sheets: rowIndex debe ser un entero >= 1");
    }

    const sheetId = await this.resolveSheetId(input.spreadsheetId, sheetName);
    const rowValues = await this.resolveRowValues(input);

    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1,
                  endIndex: rowIndex,
                },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });

      const endCol = columnIndexToLetter(Math.max(1, rowValues.length));
      const range = toA1Range(sheetName, `A${rowIndex}:${endCol}${rowIndex}`);
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [rowValues],
        },
      });

      return {
        spreadsheetId: input.spreadsheetId,
        sheetName,
        rowIndex,
        updatedRange: range,
      };
    } catch (err) {
      throw toGoogleSheetsError(err);
    }
  }

  async updateRow(input: UpdateRowInput): Promise<UpdateRowResult> {
    const sheetName = normalizeSheetName(input.sheetName);
    if (!Number.isInteger(input.rowIndex) || input.rowIndex < 1) {
      throw new Error("google_sheets: rowIndex debe ser un entero >= 1");
    }

    const headers = await this.readHeaders(input.spreadsheetId, sheetName, true);
    const rowValues = rowValuesToArray(input.values, headers);
    const endCol = columnIndexToLetter(Math.max(1, rowValues.length));
    const range = toA1Range(sheetName, `A${input.rowIndex}:${endCol}${input.rowIndex}`);

    try {
      const res = await this.sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range,
        valueInputOption: input.valueInputOption ?? "USER_ENTERED",
        requestBody: {
          values: [rowValues],
        },
      });
      return {
        spreadsheetId: input.spreadsheetId,
        sheetName,
        rowIndex: input.rowIndex,
        updatedRange: res.data.updatedRange ?? range,
        updatedCells: res.data.updatedCells ?? rowValues.length,
      };
    } catch (err) {
      throw toGoogleSheetsError(err);
    }
  }

  async deleteRow(input: DeleteRowInput): Promise<DeleteRowResult> {
    const sheetName = normalizeSheetName(input.sheetName);
    if (!Number.isInteger(input.rowIndex) || input.rowIndex < 1) {
      throw new Error("google_sheets: rowIndex debe ser un entero >= 1");
    }

    const sheetId = await this.resolveSheetId(input.spreadsheetId, sheetName);
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: input.rowIndex - 1,
                  endIndex: input.rowIndex,
                },
              },
            },
          ],
        },
      });
      return {
        spreadsheetId: input.spreadsheetId,
        sheetName,
        deletedRowIndex: input.rowIndex,
      };
    } catch (err) {
      throw toGoogleSheetsError(err);
    }
  }

  async findRows(input: FindRowsInput): Promise<FindRowsResult> {
    const sheetName = normalizeSheetName(input.sheetName);
    const hasHeaderRow = input.hasHeaderRow !== false;
    const filters = input.filters ?? [];

    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range: toA1Range(sheetName),
        majorDimension: "ROWS",
      });
      const matrix = (res.data.values ?? []) as SheetCellValue[][];
      const headers = extractHeaders(matrix, hasHeaderRow);
      const rows = filterSheetRows(matrix, headers, filters, {
        hasHeaderRow,
        limit: input.limit,
      });

      return {
        spreadsheetId: input.spreadsheetId,
        sheetName,
        headers,
        rows,
        totalMatched: rows.length,
      };
    } catch (err) {
      throw toGoogleSheetsError(err);
    }
  }

  private async resolveRowValues(input: CreateRowInput): Promise<SheetCellValue[]> {
    if (Array.isArray(input.values)) {
      return input.values;
    }
    const headers = await this.readHeaders(input.spreadsheetId, normalizeSheetName(input.sheetName), true);
    return rowValuesToArray(input.values, headers);
  }

  private async readHeaders(spreadsheetId: string, sheetName: string, hasHeaderRow: boolean): Promise<string[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: toA1Range(sheetName, "1:1"),
      majorDimension: "ROWS",
    });
    const matrix = (res.data.values ?? []) as SheetCellValue[][];
    return extractHeaders(matrix, hasHeaderRow);
  }

  private async resolveSheetId(spreadsheetId: string, sheetName: string): Promise<number> {
    const cached = this.sheetIdCache.get(spreadsheetId)?.get(sheetName);
    if (cached !== undefined) {
      return cached;
    }

    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const sheet = meta.data.sheets?.find((s) => s.properties?.title === sheetName);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
      throw new Error(`google_sheets: pestaña "${sheetName}" no encontrada`);
    }

    let bySpreadsheet = this.sheetIdCache.get(spreadsheetId);
    if (!bySpreadsheet) {
      bySpreadsheet = new Map();
      this.sheetIdCache.set(spreadsheetId, bySpreadsheet);
    }
    bySpreadsheet.set(sheetName, sheetId);
    return sheetId;
  }

  private parseRowIndexFromUpdatedRange(updatedRange: string): number | undefined {
    const match = /![A-Z]*(\d+)/i.exec(updatedRange);
    if (!match) {
      return undefined;
    }
    return Number.parseInt(match[1], 10);
  }
}
