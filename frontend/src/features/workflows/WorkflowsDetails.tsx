import { useState, useMemo } from "preact/hooks";
import type { WorkflowState, WorkflowEvent, StepRecord } from "../../api/types";

type TabId = "estado" | "eventos" | "steps";

interface Props {
  selected: { workflowId: string; runId: string } | null;
  state: WorkflowState | null;
  events: WorkflowEvent[] | null;
  steps: StepRecord[] | null;
  loading: boolean;
  error: Error | null;
}

function payloadSummary(payload: unknown): string {
  if (payload == null) return "—";
  try {
    const s = JSON.stringify(payload);
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch {
    return String(payload);
  }
}

export function WorkflowDetail({ selected, state, events, steps, loading, error }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("estado");
  const [showStateJson, setShowStateJson] = useState(false);
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Record<string, boolean>>({});

  if (!selected) {
    return <div class="panel">Selecciona un workflow para ver el detalle.</div>;
  }

  if (loading) return <div class="panel">Cargando detalle…</div>;
  if (error) return <div class="panel panel-error">Error: {error.message}</div>;
  if (!state) return <div class="panel">No se ha encontrado el estado.</div>;

  const tabs: { id: TabId; label: string }[] = [
    { id: "estado", label: "Estado" },
    { id: "eventos", label: "Eventos" },
    { id: "steps", label: "Steps" },
  ];

  const sortedEvents = useMemo(() => {
    if (!events || events.length === 0) return [];
    return [...events].sort(
      (a, b) =>
        a.version - b.version ||
        (a.startedAt || "").localeCompare(b.startedAt || "")
    );
  }, [events]);

  return (
    <div class="panel">
      <h2 class="panel-title">
        {state.id} / {state.runId}
      </h2>
      <div class="workflow-detail-header">
        <span class={`workflow-status status-${state.status}`}>{state.status}</span>
        <span>Comenzado: {state.startedAt ?? "N/A"}</span>
        {state.completedAt && <span>Completado: {state.completedAt}</span>}
        {state.failedAt && <span>Falló: {state.failedAt}</span>}
        {state.failureReason && <span>Razón: {state.failureReason}</span>}
      </div>

      <div class="tabs">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            class={activeTab === id ? "tab active" : "tab"}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div class="tab-panel">
      {activeTab === "estado" && (
          <section class="workflow-section">
            <h3>Resumen</h3>
            <ul class="detail-list">
              <li>Versión: {state.version}</li>
              {state.result !== undefined && (
                <li>Resultado: <code class="inline-code">{payloadSummary(state.result)}</code></li>
              )}
            </ul>
            <h3>Actividades pendientes</h3>
            {state.pendingActivities.length === 0 ? (
              <p class="detail-muted">Ninguna</p>
            ) : (
              <ul class="detail-list">
                {state.pendingActivities.map((a) => (
                  <li key={a.id}>
                    <strong>{a.name}</strong> (id: {a.id}) — input: {payloadSummary(a.input)}
                  </li>
                ))}
              </ul>
            )}
            <h3>Actividades completadas</h3>
            {state.completedActivities.length === 0 ? (
              <p class="detail-muted">Ninguna</p>
            ) : (
              <ul class="detail-list">
                {state.completedActivities.map((a) => (
                  <li key={a.id}>
                    <strong>{a.name}</strong> (id: {a.id}) — result: {payloadSummary(a.result)}
                  </li>
                ))}
              </ul>
            )}
            <h3>Timers pendientes</h3>
            {state.pendingTimers.length === 0 ? (
              <p class="detail-muted">Ninguno</p>
            ) : (
              <ul class="detail-list">
                {state.pendingTimers.map((t, i) => (
                  <li key={i}>Despierta: {t.wakeAt}</li>
                ))}
              </ul>
            )}
            <div class="workflow-section">
              <button
                type="button"
                class="btn-toggle-json"
                onClick={() => setShowStateJson((v) => !v)}
              >
                {showStateJson ? "Ocultar JSON" : "Ver JSON completo"}
              </button>
              {showStateJson && (
                <pre class="state-json-block">{JSON.stringify(state, null, 2)}</pre>
              )}
            </div>
          </section>
        )}

        {activeTab === "eventos" && (
          <section class="workflow-section">
            <h3>Eventos</h3>
            {sortedEvents.length === 0 ? (
              <p class="detail-muted">No hay eventos.</p>
            ) : (
              <ul class="events-list events-list--expandable">
                {sortedEvents.map((ev) => {
                  const isExpanded = expandedPayloadIds[ev.id];
                  return (
                    <li
                      key={ev.id}
                      class={`event-item event-item--expandable ${isExpanded ? "event-item--expanded" : ""}`}
                    >
                      <button
                        type="button"
                        class="event-item-trigger"
                        onClick={() =>
                          setExpandedPayloadIds((prev) => ({
                            ...prev,
                            [ev.id]: !prev[ev.id],
                          }))
                        }
                      >
                        <span class="event-item-chevron" aria-hidden="true">›</span>
                        <span class="event-type">{ev.type}</span>
                        <span class="event-meta">v{ev.version} · {ev.startedAt}</span>
                        <span class="event-payload-preview">{payloadSummary(ev.payload)}</span>
                      </button>
                      <div class={`event-payload-detail ${isExpanded ? "event-payload-detail--open" : ""}`}>
                        <pre class="event-payload-json">
                          {typeof ev.payload === "string"
                            ? ev.payload
                            : JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

{activeTab === "steps" && (
          <section class="workflow-section">
            <h3>Steps</h3>
            {!steps || steps.length === 0 ? (
              <p class="detail-muted">No hay steps.</p>
            ) : (
              <div class="steps-table-wrap">
                <table class="steps-table">
                  <thead>
                    <tr>
                      <th class="steps-th steps-th--id">Id</th>
                      <th class="steps-th steps-th--kind">Kind</th>
                      <th class="steps-th steps-th--status">Status</th>
                      <th class="steps-th steps-th--activity">Activity</th>
                      <th class="steps-th steps-th--wake">Wake at</th>
                      <th class="steps-th steps-th--branch">Branch</th>
                      <th class="steps-th steps-th--attempts">Attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((s) => (
                      <tr key={s.id} class="steps-tr">
                        <td class="steps-td steps-td--id" title={s.id}>
                          <code class="steps-id">{s.id}</code>
                        </td>
                        <td class="steps-td steps-td--kind">{s.kind}</td>
                        <td class="steps-td steps-td--status">
                          <span class={`step-status step-status--cell status-${s.status}`}>
                            {s.status}
                          </span>
                        </td>
                        <td class="steps-td steps-td--activity">
                          {s.activityName ?? (s.activityId ? <code class="steps-activity-id">{s.activityId}</code> : "—")}
                        </td>
                        <td class="steps-td steps-td--wake">{s.wakeAt ?? "—"}</td>
                        <td class="steps-td steps-td--branch">{s.branchChosen ?? "—"}</td>
                        <td class="steps-td steps-td--attempts">
                          {s.attempts != null
                            ? `${s.attempts}${s.maxAttempts != null ? ` / ${s.maxAttempts}` : ""}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}