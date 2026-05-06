import { useState, useMemo } from "preact/hooks";
import type { WorkflowState, WorkflowEvent, StepRecord } from "../../api/types";
import { useUiText } from "../../i18n";

type TabId = "estado" | "eventos" | "steps";

interface Props {
  selected: { workflowId: string; runId: string } | null;
  state: WorkflowState | null;
  events: WorkflowEvent[] | null;
  steps: StepRecord[] | null;
  loading: boolean;
  error: Error | null;
  onRefresh?: () => void;
  onCancel?: (reason?: string) => Promise<void>;
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

export function WorkflowDetail({ selected, state, events, steps, loading, error, onRefresh, onCancel }: Props) {
  const { t } = useUiText();
  const [activeTab, setActiveTab] = useState<TabId>("estado");
  const [showStateJson, setShowStateJson] = useState(false);
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Record<string, boolean>>({});
  const [isCancelling, setIsCancelling] = useState(false);

  if (!selected) {
    return <div class="panel">{t.workflows.selectOne}</div>;
  }

  if (loading) return <div class="panel">{t.workflows.loadingDetail}</div>;
  if (error) return <div class="panel panel-error">Error: {error.message}</div>;
  if (!state) return <div class="panel">{t.workflows.stateNotFound}</div>;

  const tabs: { id: TabId; label: string }[] = [
    { id: "estado", label: t.workflows.tabState },
    { id: "eventos", label: t.workflows.tabEvents },
    { id: "steps", label: t.workflows.tabSteps },
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
        <button type="button" class="workflow-filter-btn" style={{ marginRight: "8px" }} onClick={onRefresh}>
          {t.workflows.refresh}
        </button>
        {state.status === "running" && onCancel && (
          <button
            type="button"
            class="workflow-filter-btn"
            style={{ marginRight: "8px" }}
            disabled={isCancelling}
            onClick={async () => {
              const reason = window.prompt(t.workflows.cancelPrompt, "");
              setIsCancelling(true);
              try {
                await onCancel(reason ?? undefined);
              } finally {
                setIsCancelling(false);
              }
            }}
          >
            {isCancelling ? t.workflows.cancelling : t.workflows.cancelRun}
          </button>
        )}
        <button
          type="button"
          class="workflow-filter-btn"
          style={{ marginRight: "8px" }}
          onClick={() => {
            const payload = {
              state,
              events: events ?? [],
              steps: steps ?? [],
              exportedAt: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            const safeId = `${state.id}-${state.runId}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
            a.href = URL.createObjectURL(blob);
            a.download = `ftn-run-${safeId}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          {t.workflows.exportJson}
        </button>
        <span class={`workflow-status status-${state.status}`}>{state.status}</span>
        <span>
          {t.workflows.started}: {state.startedAt ?? "N/A"}
        </span>
        {state.completedAt && (
          <span>
            {t.workflows.completed}: {state.completedAt}
          </span>
        )}
        {state.failedAt && (
          <span>
            {t.workflows.failed}: {state.failedAt}
          </span>
        )}
        {state.failureReason && (
          <span>
            {t.workflows.reason}: {state.failureReason}
          </span>
        )}
        {state.cancelledAt && (
          <span>
            {t.workflows.cancelled}: {state.cancelledAt}
          </span>
        )}
        {state.cancellationReason && (
          <span>
            {t.workflows.cancelReason}: {state.cancellationReason}
          </span>
        )}
        {state.cancellationRequestedBy && (
          <span>
            {t.workflows.requestedBy}: {state.cancellationRequestedBy}
          </span>
        )}
        {state.status === "running" && (
          <span class="workflow-live-pill">
            <span class="workflow-live-dot" />
            {t.workflows.liveEvery}
          </span>
        )}
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
            <h3>{t.workflows.summary}</h3>
            <ul class="detail-list">
              <li>
                {t.workflows.version}: {state.version}
              </li>
              <li>
                {t.workflows.diagnostics}: pendientes=
                {state.pendingActivities.length + state.pendingTimers.length + (state.pendingSignalWaits?.length ?? 0)}
                {" · "}
                retries={(events ?? []).filter((e) => e.type === "RetryAttemptStarted").length}
              </li>
              {events && events.length > 0 && (
                <li>
                  {t.workflows.lastEvent}: {events[events.length - 1]!.type}
                </li>
              )}
              {state.result !== undefined && (
                <li>Resultado: <code class="inline-code">{payloadSummary(state.result)}</code></li>
              )}
            </ul>
            <h3>{t.workflows.pendingActivities}</h3>
            {state.pendingActivities.length === 0 ? (
              <p class="detail-muted">{t.workflows.noPendingActivities}</p>
            ) : (
              <ul class="detail-list">
                {state.pendingActivities.map((a) => (
                <li key={a.id}>
                  <strong>{a.name}</strong> (id: {a.id}
                  {a.attempt != null ? ` · intento ${a.attempt}` : ""})
                  — input: {payloadSummary(a.input)}
                </li>
              ))}
              </ul>
            )}
            <h3>{t.workflows.completedActivities}</h3>
            {state.completedActivities.length === 0 ? (
              <p class="detail-muted">{t.workflows.noCompletedActivities}</p>
            ) : (
              <ul class="detail-list">
                {state.completedActivities.map((a) => (
                <li key={a.id}>
                  <strong>{a.name}</strong> (id: {a.id}
                  {a.attempt != null ? ` · intento ${a.attempt}` : ""})
                  — result: {payloadSummary(a.result)}
                </li>
              ))}
              </ul>
            )}
            <h3>{t.workflows.pendingTimers}</h3>
            {state.pendingTimers.length === 0 ? (
              <p class="detail-muted">{t.workflows.noPendingTimers}</p>
            ) : (
              <ul class="detail-list">
                {state.pendingTimers.map((t, i) => (
                  <li key={i}>
                    {t.workflows.wakeAt}: {t.wakeAt}
                  </li>
                ))}
              </ul>
            )}
            <div class="workflow-section">
              <button
                type="button"
                class="btn-toggle-json"
                onClick={() => setShowStateJson((v) => !v)}
              >
                {showStateJson ? t.workflows.hideJson : t.workflows.showJson}
              </button>
              {showStateJson && (
                <pre class="state-json-block">{JSON.stringify(state, null, 2)}</pre>
              )}
            </div>
          </section>
        )}

        {activeTab === "eventos" && (
          <section class="workflow-section">
            <h3>{t.workflows.eventsTitle}</h3>
            {sortedEvents.length === 0 ? (
              <p class="detail-muted">{t.workflows.noEventsYet}</p>
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
            <h3>{t.workflows.stepsTitle}</h3>
            {!steps || steps.length === 0 ? (
              <p class="detail-muted">{t.workflows.noStepsYet}</p>
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