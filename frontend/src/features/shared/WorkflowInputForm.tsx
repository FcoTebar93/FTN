import type { JsonSchema } from "../../api/types";
import { getFieldInputType } from "../../shared/json-schema-input";

type WorkflowInputFormProps = {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  fieldErrors?: Record<string, string>;
  errorMessage: (code: string, field: string) => string;
};

export function WorkflowInputForm({
  schema,
  values,
  onChange,
  fieldErrors = {},
  errorMessage,
}: WorkflowInputFormProps) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  function setField(name: string, value: unknown): void {
    onChange({ ...values, [name]: value });
  }

  return (
    <div class="workflow-input-form">
      {Object.entries(properties).map(([name, prop]) => {
        const label = prop.description?.trim() || prop.title?.trim() || name;
        const fieldType = getFieldInputType(prop);
        const err = fieldErrors[name];
        const value = values[name];

        return (
          <div class="form-row" key={name}>
            <label>
              {label}
              {required.has(name) ? " *" : ""}
            </label>
            {fieldType === "checkbox" ? (
              <input
                type="checkbox"
                checked={Boolean(value)}
                onInput={(e) => setField(name, (e.target as HTMLInputElement).checked)}
              />
            ) : fieldType === "select" ? (
              <select
                value={value === undefined || value === null ? "" : String(value)}
                onInput={(e) => setField(name, (e.target as HTMLSelectElement).value)}
              >
                <option value="">—</option>
                {(prop.enum ?? []).map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={fieldType}
                value={value === undefined || value === null ? "" : String(value)}
                onInput={(e) => {
                  const raw = (e.target as HTMLInputElement).value;
                  if (fieldType === "number") {
                    const trimmed = raw.trim();
                    if (trimmed === "") {
                      setField(name, "");
                      return;
                    }
                    const n = Number(trimmed);
                    setField(name, Number.isFinite(n) ? n : raw);
                    return;
                  }
                  setField(name, raw);
                }}
              />
            )}
            {err ? <p class="login-error" style={{ marginTop: "4px" }}>{errorMessage(err, label)}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
