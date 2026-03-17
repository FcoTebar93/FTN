import { useEffect, useState } from "preact/hooks";
import { getCatalogWorkflows, startWorkflow } from "../../api/workflows";
import type { CatalogWorkflow } from "../../api/types";

export function WorkflowsCatalogPage() {
  const [items, setItems] = useState<CatalogWorkflow[]>([]);
  const [selected, setSelected] = useState<CatalogWorkflow | null>(null);
  const [inputValue, setInputValue] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastRun, setLastRun] = useState<{ workflowId: string; runId: string } | null>(null);

  useEffect(() => {
    getCatalogWorkflows()
      .then(setItems)
      .catch((e) => setError(e as Error));
  }, []);

  function handleSelect(wf: CatalogWorkflow) {
    setSelected(wf);
    setInputValue({});
    setLastRun(null);
    setError(null);
  }

  async function handleLaunch() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await startWorkflow(selected.name, inputValue);
      setLastRun(res);
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
            <p class="detail-muted">Elige un workflow para ver detalles y lanzarlo.</p>
          ) : (
            <>
              <h2 class="panel-title">{selected.displayName || selected.name}</h2>
              {selected.description && <p class="detail-muted">{selected.description}</p>}

              <section class="workflow-section">
                <h3>Input</h3>
              </section>

              <section class="workflow-section">
                <button
                  type="button"
                  class="workflow-filter-btn"
                  disabled={loading}
                  onClick={handleLaunch}
                >
                  {loading ? "Lanzando..." : "Lanzar workflow"}
                </button>
                {lastRun && (
                  <p class="detail-muted">
                    Lanzado: workflowId={lastRun.workflowId}, runId={lastRun.runId}
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}