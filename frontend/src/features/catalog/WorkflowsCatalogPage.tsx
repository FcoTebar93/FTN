import { useEffect, useMemo, useState } from "preact/hooks";
import { getCatalogWorkflows, startWorkflow, getWorkflowState, sendWorkflowSignal } from "../../api/workflows";
import type { CatalogWorkflow } from "../../api/types";
import type { WorkflowState } from "../../api/types";
import { useUiText } from "../../i18n";
import { WorkflowInputForm } from "../shared/WorkflowInputForm";
import {
  isFormRenderableSchema,
  mergeInputWithSchema,
  validateFormInput,
} from "../../shared/json-schema-input";

function stringifyInput(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function resolveInitialInput(wf: CatalogWorkflow): Record<string, unknown> {
  const example = wf.examples?.[0]?.input;
  return mergeInputWithSchema(wf.inputSchema, example);
}

export function WorkflowsCatalogPage() {
  const { t } = useUiText();
  const [items, setItems] = useState<CatalogWorkflow[]>([]);
  const [selected, setSelected] = useState<CatalogWorkflow | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [inputJson, setInputJson] = useState<string>("{}");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastRun, setLastRun] = useState<{ workflowId: string; runId: string; version: number } | null>(null);
  const [liveState, setLiveState] = useState<WorkflowState | null>(null);
  const [signalName, setSignalName] = useState("");
  const [signalDataJson, setSignalDataJson] = useState("{}");

  const canUseForm = useMemo(
    () => Boolean(selected?.inputSchema && isFormRenderableSchema(selected.inputSchema)),
    [selected?.inputSchema]
  );

  useEffect(() => {
    getCatalogWorkflows()
      .then(setItems)
      .catch((e) => setError(e as Error));
  }, []);

  useEffect(() => {
    if (!lastRun) {
      setLiveState(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getWorkflowState(lastRun.workflowId, lastRun.runId);
        if (!cancelled) setLiveState(s);
      } catch {
        if (!cancelled) setLiveState(null);
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [lastRun]);

  function fieldErrorMessage(code: string, fieldLabel: string): string {
    switch (code) {
      case "required":
        return t.catalog.fieldRequired(fieldLabel);
      case "email":
        return t.catalog.fieldEmail(fieldLabel);
      case "number":
        return t.catalog.fieldNumber(fieldLabel);
      case "minimum":
        return t.catalog.fieldMinimum(fieldLabel);
      default:
        return fieldLabel;
    }
  }

  function handleSelect(wf: CatalogWorkflow) {
    setSelected(wf);
    setError(null);
    setLastRun(null);
    setLiveState(null);
    setFieldErrors({});
    const initial = resolveInitialInput(wf);
    const useForm = Boolean(wf.inputSchema && isFormRenderableSchema(wf.inputSchema));
    setFormValues(initial);
    setInputJson(stringifyInput(initial));
    setAdvancedMode(!useForm);
  }

  function applyExample(input: unknown) {
    if (!selected) return;
    const merged = mergeInputWithSchema(selected.inputSchema, input);
    setFormValues(merged);
    setInputJson(stringifyInput(merged));
    setFieldErrors({});
  }

  function toggleAdvancedMode(next: boolean) {
    if (!selected) return;
    if (next) {
      setInputJson(stringifyInput(formValues));
      setAdvancedMode(true);
      return;
    }
    try {
      const parsed = inputJson.trim() === "" ? {} : JSON.parse(inputJson);
      const merged = mergeInputWithSchema(selected.inputSchema, parsed);
      setFormValues(merged);
      setFieldErrors({});
      setAdvancedMode(false);
    } catch {
      setError(new Error(t.catalog.inputInvalid));
    }
  }

  async function handleLaunch() {
    if (!selected) return;
    let input: unknown;

    if (advancedMode || !canUseForm) {
      try {
        input = inputJson.trim() === "" ? {} : JSON.parse(inputJson);
      } catch {
        setError(new Error(t.catalog.inputInvalid));
        return;
      }
    } else if (selected.inputSchema) {
      const errors = validateFormInput(selected.inputSchema, formValues);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }
      input = formValues;
    } else {
      input = formValues;
    }

    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await startWorkflow(selected.name, input);
      setLastRun(res);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendSignal() {
    if (!lastRun) return;
    let data: unknown;
    try {
      data = signalDataJson.trim() === "" ? undefined : JSON.parse(signalDataJson);
    } catch {
      setError(new Error(t.catalog.signalDataInvalid));
      return;
    }
    if (!signalName.trim()) {
      setError(new Error(t.catalog.signalNameRequired));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendWorkflowSignal(lastRun.workflowId, lastRun.runId, signalName.trim(), data);
      const s = await getWorkflowState(lastRun.workflowId, lastRun.runId);
      setLiveState(s);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="app-layout">
      <div class="sidebar">
        <div class="panel">
          <h2 class="panel-title">{t.catalog.title}</h2>
          <p class="detail-muted" style={{ marginBottom: "0.75rem" }}>
            <a href="/runs">{t.nav.runs}</a>
          </p>
          {error && <p class="panel panel-error">Error: {error.message}</p>}
          <ul class="workflow-list">
            {items.map((wf) => (
              <li
                key={wf.name}
                class="workflow-list-item"
                onClick={() => handleSelect(wf)}
                style={{ cursor: "pointer" }}
              >
                <div class="workflow-name">{wf.displayName || wf.name}</div>
                <div class="workflow-meta">
                  <span>{wf.name}</span> · <span>v{wf.version}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div class="content">
        <div class="panel">
          {!selected ? (
            <p class="detail-muted">{t.catalog.chooseOne}</p>
          ) : (
            <>
              <h2 class="panel-title">{selected.displayName || selected.name}</h2>
              {selected.description && <p class="detail-muted">{selected.description}</p>}

              <section class="workflow-section">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0 }}>{advancedMode ? t.catalog.inputJsonTitle : t.catalog.inputFormTitle}</h3>
                  {canUseForm ? (
                    <button
                      type="button"
                      class="workflow-filter-btn"
                      onClick={() => toggleAdvancedMode(!advancedMode)}
                    >
                      {advancedMode ? t.catalog.formMode : t.catalog.advancedJsonMode}
                    </button>
                  ) : null}
                </div>
                {!advancedMode && canUseForm && selected.inputSchema ? (
                  <p class="detail-muted">{t.catalog.inputFormHelp}</p>
                ) : (
                  <p class="detail-muted">
                    {t.catalog.inputJsonHelp.replace("inputSchema", "")}
                    <code>inputSchema</code>
                  </p>
                )}

                {selected.examples && selected.examples.length > 0 && (
                  <div class="workflow-section" style={{ marginBottom: "0.5rem" }}>
                    {selected.examples.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        class="workflow-filter-btn"
                        style={{ marginRight: "0.5rem", marginBottom: "0.25rem" }}
                        onClick={() => applyExample(ex.input)}
                      >
                        {t.catalog.loadExample(i + 1)}
                        {ex.note ? ` (${ex.note})` : ""}
                      </button>
                    ))}
                  </div>
                )}

                {!advancedMode && canUseForm && selected.inputSchema ? (
                  <WorkflowInputForm
                    schema={selected.inputSchema}
                    values={formValues}
                    onChange={(next) => {
                      setFormValues(next);
                      setFieldErrors({});
                    }}
                    fieldErrors={fieldErrors}
                    errorMessage={fieldErrorMessage}
                  />
                ) : (
                  <textarea
                    class="workflow-filter-btn"
                    style={{
                      width: "100%",
                      minHeight: "140px",
                      fontFamily: "monospace",
                      fontSize: "13px",
                      padding: "8px",
                      boxSizing: "border-box",
                    }}
                    value={inputJson}
                    onInput={(e) => setInputJson((e.target as HTMLTextAreaElement).value)}
                    spellcheck={false}
                  />
                )}
              </section>

              <section class="workflow-section">
                <button type="button" class="workflow-filter-btn" disabled={loading} onClick={handleLaunch}>
                  {loading ? t.catalog.launching : t.catalog.launch}
                </button>
                {lastRun && (
                  <p class="detail-muted" style={{ marginTop: "0.75rem" }}>
                    Run: <code>{lastRun.workflowId}</code> / <code>{lastRun.runId}</code> (v{lastRun.version})
                  </p>
                )}
              </section>

              {lastRun && (
                <section class="workflow-section">
                  <h3>{t.catalog.statePolling}</h3>
                  {liveState ? (
                    <pre
                      class="detail-muted"
                      style={{
                        whiteSpace: "pre-wrap",
                        fontSize: "12px",
                        maxHeight: "220px",
                        overflow: "auto",
                        padding: "8px",
                        background: "var(--panel-bg, #1a1a1e)",
                        borderRadius: "6px",
                      }}
                    >
                      {JSON.stringify(liveState, null, 2)}
                    </pre>
                  ) : (
                    <p class="detail-muted">{t.catalog.loadingState}</p>
                  )}
                </section>
              )}

              {lastRun && liveState && (liveState.pendingSignalWaits?.length ?? 0) > 0 && (
                <section class="workflow-section">
                  <h3>{t.catalog.sendSignal}</h3>
                  <p class="detail-muted">
                    {t.catalog.pendingSignals}:{" "}
                    {(liveState.pendingSignalWaits ?? []).map((w) => w.signalName).join(", ") || "—"}
                  </p>
                  <input
                    type="text"
                    placeholder="signalName"
                    value={signalName}
                    onInput={(e) => setSignalName((e.target as HTMLInputElement).value)}
                    style={{ width: "100%", marginBottom: "0.5rem", padding: "6px" }}
                  />
                  <textarea
                    placeholder='{"key":"value"}'
                    value={signalDataJson}
                    onInput={(e) => setSignalDataJson((e.target as HTMLTextAreaElement).value)}
                    style={{ width: "100%", minHeight: "72px", fontFamily: "monospace", fontSize: "12px" }}
                  />
                  <button
                    type="button"
                    class="workflow-filter-btn"
                    style={{ marginTop: "0.5rem" }}
                    disabled={loading}
                    onClick={handleSendSignal}
                  >
                    {t.catalog.send}
                  </button>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}