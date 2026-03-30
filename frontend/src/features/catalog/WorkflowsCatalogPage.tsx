import { useEffect, useState } from "preact/hooks";
import { getCatalogWorkflows, startWorkflow, getWorkflowState, sendWorkflowSignal } from "../../api/workflows";
import type { CatalogWorkflow } from "../../api/types";
import type { WorkflowState } from "../../api/types";

function stringifyInput(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export function WorkflowsCatalogPage() {
  const [items, setItems] = useState<CatalogWorkflow[]>([]);
  const [selected, setSelected] = useState<CatalogWorkflow | null>(null);
  const [inputJson, setInputJson] = useState<string>("{}");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastRun, setLastRun] = useState<{ workflowId: string; runId: string; version: number } | null>(null);
  const [liveState, setLiveState] = useState<WorkflowState | null>(null);
  const [signalName, setSignalName] = useState("");
  const [signalDataJson, setSignalDataJson] = useState("{}");

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

  function handleSelect(wf: CatalogWorkflow) {
    setSelected(wf);
    setError(null);
    setLastRun(null);
    setLiveState(null);
    const ex = wf.examples?.[0]?.input;
    setInputJson(stringifyInput(ex !== undefined ? ex : {}));
  }

  async function handleLaunch() {
    if (!selected) return;
    let input: unknown;
    try {
      input = inputJson.trim() === "" ? {} : JSON.parse(inputJson);
    } catch (e) {
      setError(new Error("Input JSON inválido"));
      return;
    }
    setLoading(true);
    setError(null);
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
      setError(new Error("Signal data JSON inválido"));
      return;
    }
    if (!signalName.trim()) {
      setError(new Error("Indica signalName"));
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
          <h2 class="panel-title">Workflows</h2>
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
            <p class="detail-muted">Elige un workflow para ver el contrato, validar input y lanzarlo.</p>
          ) : (
            <>
              <h2 class="panel-title">{selected.displayName || selected.name}</h2>
              {selected.description && <p class="detail-muted">{selected.description}</p>}

              <section class="workflow-section">
                <h3>Input (JSON)</h3>
                <p class="detail-muted">
                  Debe cumplir el <code>inputSchema</code> del servidor. Usa un ejemplo si existe.
                </p>
                {selected.examples && selected.examples.length > 0 && (
                  <div class="workflow-section" style={{ marginBottom: "0.5rem" }}>
                    {selected.examples.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        class="workflow-filter-btn"
                        style={{ marginRight: "0.5rem", marginBottom: "0.25rem" }}
                        onClick={() => setInputJson(stringifyInput(ex.input))}
                      >
                        Cargar ejemplo {i + 1}
                        {ex.note ? ` (${ex.note})` : ""}
                      </button>
                    ))}
                  </div>
                )}
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
              </section>

              <section class="workflow-section">
                <button type="button" class="workflow-filter-btn" disabled={loading} onClick={handleLaunch}>
                  {loading ? "Lanzando..." : "Lanzar workflow"}
                </button>
                {lastRun && (
                  <p class="detail-muted" style={{ marginTop: "0.75rem" }}>
                    Run: <code>{lastRun.workflowId}</code> / <code>{lastRun.runId}</code> (v{lastRun.version})
                  </p>
                )}
              </section>

              {lastRun && (
                <section class="workflow-section">
                  <h3>Estado (polling 2s)</h3>
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
                    <p class="detail-muted">Cargando estado…</p>
                  )}
                </section>
              )}

              {lastRun && liveState && (liveState.pendingSignalWaits?.length ?? 0) > 0 && (
                <section class="workflow-section">
                  <h3>Enviar señal</h3>
                  <p class="detail-muted">
                    Pendientes:{" "}
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
                    Enviar señal
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
