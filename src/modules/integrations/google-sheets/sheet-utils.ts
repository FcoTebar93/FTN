import type { FindRowsFilter, FindRowsOperator, SheetCellValue } from "./types";

export const DEFAULT_SHEET_NAME = "Sheet1";

export function normalizeSheetName(sheetName: string | undefined): string {
  const trimmed = sheetName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SHEET_NAME;
}

export function quoteSheetName(sheetName: string): string {
  if (/^[A-Za-z0-9_]+$/.test(sheetName)) {
    return sheetName;
  }
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export function toA1Range(sheetName: string, a1?: string): string {
  const quoted = quoteSheetName(sheetName);
  return a1 ? `${quoted}!${a1}` : quoted;
}

export function columnIndexToLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function letterToColumnIndex(letters: string): number {
  const normalized = letters.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error(`google_sheets: columna inválida "${letters}"`);
  }
  let index = 0;
  for (let i = 0; i < normalized.length; i++) {
    index = index * 26 + (normalized.charCodeAt(i) - 64);
  }
  return index;
}

export function isColumnLetter(value: string): boolean {
  return /^[A-Za-z]{1,3}$/.test(value.trim());
}

export function rowValuesToArray(
  values: SheetCellValue[] | Record<string, SheetCellValue>,
  headers: string[]
): SheetCellValue[] {
  if (Array.isArray(values)) {
    return values;
  }
  const row = new Array<SheetCellValue>(headers.length).fill(null);
  for (const [key, cell] of Object.entries(values)) {
    const headerIndex = headers.findIndex((h) => h === key);
    if (headerIndex >= 0) {
      row[headerIndex] = cell;
      continue;
    }
    if (isColumnLetter(key)) {
      const idx = letterToColumnIndex(key) - 1;
      if (idx >= row.length) {
        row.length = idx + 1;
        row.fill(null, headers.length, idx);
      }
      row[idx] = cell;
      continue;
    }
    throw new Error(`google_sheets: columna desconocida "${key}"`);
  }
  return row;
}

function compareValues(left: SheetCellValue, right: SheetCellValue, operator: FindRowsOperator): boolean {
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;

  switch (operator) {
    case "eq":
      return String(l) === String(r);
    case "ne":
      return String(l) !== String(r);
    case "contains":
      return String(l).toLowerCase().includes(String(r ?? "").toLowerCase());
    case "startsWith":
      return String(l).toLowerCase().startsWith(String(r ?? "").toLowerCase());
    case "gt":
      return Number(l) > Number(r);
    case "gte":
      return Number(l) >= Number(r);
    case "lt":
      return Number(l) < Number(r);
    case "lte":
      return Number(l) <= Number(r);
    default:
      return false;
  }
}

export function filterSheetRows(
  matrix: SheetCellValue[][],
  headers: string[],
  filters: FindRowsFilter[],
  options: { hasHeaderRow: boolean; limit?: number }
): { rowIndex: number; values: Record<string, SheetCellValue> }[] {
  const startRow = options.hasHeaderRow ? 1 : 0;
  const matched: { rowIndex: number; values: Record<string, SheetCellValue> }[] = [];
  const max = options.limit && options.limit > 0 ? options.limit : undefined;

  for (let i = startRow; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const record: Record<string, SheetCellValue> = {};
    headers.forEach((header, idx) => {
      record[header] = row[idx] ?? null;
    });

    const passes =
      filters.length === 0 ||
      filters.every((filter) => {
        const columnKey =
          headers.find((h) => h === filter.column) ??
          (isColumnLetter(filter.column) ? headers[letterToColumnIndex(filter.column) - 1] : filter.column);
        const cell = record[columnKey] ?? null;
        return compareValues(cell, filter.value, filter.operator);
      });

    if (!passes) {
      continue;
    }

    matched.push({
      rowIndex: i + 1,
      values: record,
    });

    if (max !== undefined && matched.length >= max) {
      break;
    }
  }

  return matched;
}

export function extractHeaders(matrix: SheetCellValue[][], hasHeaderRow: boolean): string[] {
  if (hasHeaderRow && matrix.length > 0) {
    return (matrix[0] ?? []).map((cell, idx) => {
      const label = cell === null || cell === undefined || cell === "" ? `col_${idx + 1}` : String(cell);
      return label;
    });
  }
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, idx) => columnIndexToLetter(idx + 1));
}
