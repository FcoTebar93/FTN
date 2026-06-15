export type SheetCellValue = string | number | boolean | null;

export interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export interface GoogleSheetsServiceAccountAuthConfig {
  kind: "service_account";
  serviceAccount: GoogleServiceAccountCredentials;
  impersonateEmail?: string;
}

export interface GoogleSheetsOAuthAuthConfig {
  kind: "oauth2";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

export type GoogleSheetsAuthConfig = GoogleSheetsServiceAccountAuthConfig | GoogleSheetsOAuthAuthConfig;

export interface SpreadsheetTarget {
  spreadsheetId: string;
  sheetName?: string;
}

export interface AppendRowsInput extends SpreadsheetTarget {
  rows: SheetCellValue[][];
  valueInputOption?: "RAW" | "USER_ENTERED";
}

export interface AppendRowsResult {
  spreadsheetId: string;
  sheetName: string;
  updatedRange: string;
  updatedRows: number;
}

export interface CreateRowInput extends SpreadsheetTarget {
  rowIndex?: number;
  values: SheetCellValue[] | Record<string, SheetCellValue>;
}

export interface CreateRowResult {
  spreadsheetId: string;
  sheetName: string;
  rowIndex: number;
  updatedRange: string;
}

export interface UpdateRowInput extends SpreadsheetTarget {
  rowIndex: number;
  values: SheetCellValue[] | Record<string, SheetCellValue>;
  valueInputOption?: "RAW" | "USER_ENTERED";
}

export interface UpdateRowResult {
  spreadsheetId: string;
  sheetName: string;
  rowIndex: number;
  updatedRange: string;
  updatedCells: number;
}

export interface DeleteRowInput extends SpreadsheetTarget {
  rowIndex: number;
}

export interface DeleteRowResult {
  spreadsheetId: string;
  sheetName: string;
  deletedRowIndex: number;
}

export type FindRowsOperator = "eq" | "ne" | "contains" | "startsWith" | "gt" | "gte" | "lt" | "lte";

export interface FindRowsFilter {
  column: string;
  operator: FindRowsOperator;
  value: SheetCellValue;
}

export interface FindRowsInput extends SpreadsheetTarget {
  filters?: FindRowsFilter[];
  limit?: number;
  hasHeaderRow?: boolean;
}

export interface FoundSheetRow {
  rowIndex: number;
  values: Record<string, SheetCellValue>;
}

export interface FindRowsResult {
  spreadsheetId: string;
  sheetName: string;
  headers: string[];
  rows: FoundSheetRow[];
  totalMatched: number;
}

export interface GoogleSheetsClient {
  appendRows(input: AppendRowsInput): Promise<AppendRowsResult>;
  createRow(input: CreateRowInput): Promise<CreateRowResult>;
  updateRow(input: UpdateRowInput): Promise<UpdateRowResult>;
  deleteRow(input: DeleteRowInput): Promise<DeleteRowResult>;
  findRows(input: FindRowsInput): Promise<FindRowsResult>;
}
