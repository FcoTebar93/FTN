import { useState } from "preact/hooks";
import {
  GOOGLE_SHEETS_ACTIVITIES,
  googleSheetsActivityLabel,
} from "./google-sheets-activities";

type GoogleSheetsDesignerText = {
  spreadsheetId: string;
  spreadsheetIdHint: string;
  sheetName: string;
  rowIndex: string;
  rowsJson: string;
  rowsJsonHint: string;
  valuesJson: string;
  valuesJsonHint: string;
  filtersJson: string;
  filtersJsonHint: string;
  limit: string;
  hasHeaderRow: string;
  valueInputOption: string;
  jsonInvalid: string;
  chooseAction: string;
};

type Props = {
  activityName: string;
  input: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  labels: GoogleSheetsDesignerText;
};

function stringifyJson(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function parseJsonField(
  raw: string,
  fallback: unknown,
  onInvalid: () => void
): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    onInvalid();
    return undefined;
  }
}

export function GoogleSheetsStepInput({ activityName, input, onChange, labels }: Props) {
  const preset = googleSheetsActivityLabel(activityName);
  const [jsonError, setJsonError] = useState<string | null>(null);

  function patch(partial: Record<string, unknown>): void {
    setJsonError(null);
    onChange({ ...input, ...partial });
  }

  if (!preset) {
    return <p class="detail-muted">{labels.chooseAction}</p>;
  }

  return (
    <div class="google-sheets-step-input">
      <div class="form-row">
        <label>{labels.spreadsheetId} *</label>
        <input
          type="text"
          value={String(input.spreadsheetId ?? "")}
          placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
          onInput={(e) => patch({ spreadsheetId: (e.target as HTMLInputElement).value })}
        />
        <p class="detail-muted">{labels.spreadsheetIdHint}</p>
      </div>

      <div class="form-row">
        <label>{labels.sheetName}</label>
        <input
          type="text"
          value={String(input.sheetName ?? "Hoja 1")}
          onInput={(e) => patch({ sheetName: (e.target as HTMLInputElement).value })}
        />
      </div>

      {preset === "deleteRow" || preset === "updateRow" ? (
        <div class="form-row">
          <label>{labels.rowIndex} *</label>
          <input
            type="number"
            min={1}
            value={input.rowIndex === undefined ? "" : String(input.rowIndex)}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              patch({ rowIndex: raw === "" ? undefined : Number(raw) });
            }}
          />
        </div>
      ) : null}

      {preset === "createRow" ? (
        <div class="form-row">
          <label>{labels.rowIndex}</label>
          <input
            type="number"
            min={1}
            value={input.rowIndex === undefined ? "" : String(input.rowIndex)}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              patch({ rowIndex: raw === "" ? undefined : Number(raw) });
            }}
          />
        </div>
      ) : null}

      {preset === "appendRows" ? (
        <>
          <div class="form-row">
            <label>{labels.rowsJson} *</label>
            <textarea
              rows={6}
              value={stringifyJson(input.rows, '[["col1", "col2"]]')}
              onInput={(e) => {
                const parsed = parseJsonField(
                  (e.target as HTMLTextAreaElement).value,
                  [],
                  () => setJsonError(labels.jsonInvalid)
                );
                if (parsed !== undefined) patch({ rows: parsed });
              }}
            />
            <p class="detail-muted">{labels.rowsJsonHint}</p>
          </div>
          <div class="form-row">
            <label>{labels.valueInputOption}</label>
            <select
              value={String(input.valueInputOption ?? "USER_ENTERED")}
              onInput={(e) => patch({ valueInputOption: (e.target as HTMLSelectElement).value })}
            >
              <option value="USER_ENTERED">USER_ENTERED</option>
              <option value="RAW">RAW</option>
            </select>
          </div>
        </>
      ) : null}

      {preset === "createRow" || preset === "updateRow" ? (
        <>
          <div class="form-row">
            <label>{labels.valuesJson} *</label>
            <textarea
              rows={5}
              value={stringifyJson(input.values, '{"status": "pending"}')}
              onInput={(e) => {
                const parsed = parseJsonField(
                  (e.target as HTMLTextAreaElement).value,
                  {},
                  () => setJsonError(labels.jsonInvalid)
                );
                if (parsed !== undefined) patch({ values: parsed });
              }}
            />
            <p class="detail-muted">{labels.valuesJsonHint}</p>
          </div>
          {preset === "updateRow" ? (
            <div class="form-row">
              <label>{labels.valueInputOption}</label>
              <select
                value={String(input.valueInputOption ?? "USER_ENTERED")}
                onInput={(e) => patch({ valueInputOption: (e.target as HTMLSelectElement).value })}
              >
                <option value="USER_ENTERED">USER_ENTERED</option>
                <option value="RAW">RAW</option>
              </select>
            </div>
          ) : null}
        </>
      ) : null}

      {preset === "findRows" ? (
        <>
          <div class="form-row">
            <label>{labels.filtersJson}</label>
            <textarea
              rows={6}
              value={stringifyJson(input.filters, '[{"column":"status","operator":"eq","value":"pending"}]')}
              onInput={(e) => {
                const parsed = parseJsonField(
                  (e.target as HTMLTextAreaElement).value,
                  [],
                  () => setJsonError(labels.jsonInvalid)
                );
                if (parsed !== undefined) patch({ filters: parsed });
              }}
            />
            <p class="detail-muted">{labels.filtersJsonHint}</p>
          </div>
          <div class="form-row">
            <label>{labels.limit}</label>
            <input
              type="number"
              min={1}
              value={input.limit === undefined ? "" : String(input.limit)}
              onInput={(e) => {
                const raw = (e.target as HTMLInputElement).value;
                patch({ limit: raw === "" ? undefined : Number(raw) });
              }}
            />
          </div>
          <label class="credentials-advanced-toggle">
            <input
              type="checkbox"
              checked={input.hasHeaderRow !== false}
              onInput={(e) => patch({ hasHeaderRow: (e.target as HTMLInputElement).checked })}
            />
            {labels.hasHeaderRow}
          </label>
        </>
      ) : null}

      {jsonError ? <p class="credentials-error">{jsonError}</p> : null}
    </div>
  );
}
