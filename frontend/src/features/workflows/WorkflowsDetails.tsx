import { useState, useMemo } from "preact/hooks";
import type { WorkflowState, WorkflowEvent, StepRecord } from "../../api/types";
import { useLocale, useUiText } from "../../i18n";
import { authorRunSummary, buildAuthorTimeline, friendlyStatus } from "./run-friendly";

type TabId = "resumen" | "pasos" | "tecnico";

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

function stepDetail(step: StepRecord): string {
  if (step.activityName) return step.activityName;
  if (step.wakeAt) return step.wakeAt;
  if (step.branchChosen) return step.branchChosen;
  return "—";
}

export function WorkflowDetail({ selected, state, events, steps, loading, error, onRefresh, onCancel }: Props) {
  const { t } = useUiText();
  const [locale] = useLocale();
  const [activeTab, setActiveTab] = useState<TabId>("resumen");
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
    { id: "resumen", label: t.workflows.tabSummary },
    { id: "pasos", label: t.workflows.tabSteps },
    { id: "tecnico", label: t.workflows.tabTechnical },
  ];

  const sortedEvents = useMemo(() => {
    if (!events || events.length === 0) return [];
    return [...events].sort(
      (a, b) =>
        a.version - b.version ||
        (a.startedAt || "").localeCompare(b.startedAt || "")
    );
  }, [events]);

  const timeline = useMemo(
    () => buildAuthorTimeline(events, steps, locale),
    [events, steps, locale]
  );

  const summaryLines = useMemo(() => authorRunSummary(state, locale), [state, locale]);

  const displayTitle = state.id.includes("::")
    ? state.id.split("::").slice(1).join("::")
    : state.id;

  return (
    <div class="panel">
      <h2 class="panel-title">{displayTitle}</h2>
      <p class="detail-muted">
        {state.startedAt ? new Date(state.startedAt).toLocaleString() : t.workflows.noDate}
      </p>
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
        <span class={`workflow-status status-${state.status}`}>{friendlyStatus(state.status, locale)}</span>
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
        {activeTab === "resumen" && (
          <section class="workflow-section">
            <h3>{t.workflows.summary}</h3>
            <ul class="detail-list author-summary-list">
              {summaryLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <h3>{t.workflows.timelineTitle}</h3>
            {timeline.length === 0 ? (
              <p class="detail-muted">{t.workflows.noTimelineYet}</p>
            ) : (
              <ul class="author-timeline">
                {timeline.map((item, idx) => (
                  <li key={`${item.label}-${idx}`} class={`author-timeline-item author-timeline-item--${item.tone}`}>
                    <span class="author-timeline-marker" aria-hidden="true" />
                    <div>
                      {item.at ? <div class="detail-muted">{new Date(item.at).toLocaleString()}</div> : null}
                      <div>{item.label}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {state.failureReason && (
              <p class="panel panel-error" style={{ marginTop: "12px" }}>
                {state.failureReason}
              </p>
            )}
          </section>
        )}

        {activeTab === "pasos" && (
          <section class="workflow-section">
            <h3>{t.workflows.stepsTitle}</h3>
            {!steps || steps.length === 0 ? (
              <p class="detail-muted">{t.workflows.noStepsYet}</p>
            ) : (
              <div class="steps-table-wrap">
                <table class="steps-table steps-table--author">
                  <thead>
                    <tr>
                      <th class="steps-th">{t.workflows.stepColumnName}</th>
                      <th class="steps-th">{t.workflows.stepColumnStatus}</th>
                      <th class="steps-th">{t.workflows.stepColumnDetail}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((s) => (
                      <tr key={s.id} class="steps-tr">
                        <td class="steps-td">{s.id}</td>
                        <td class="steps-td">
                          <span class={`step-status step-status--cell status-${s.status}`}>
                            {friendlyStatus(s.status, locale)}
                          </span>
                        </td>
                        <td class="steps-td">{stepDetail(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === "tecnico" && (
          <section class="workflow-section">
            <div class="workflow-detail-header" style={{ marginBottom: "12px" }}>
              <button
                type="button"
                class="workflow-filter-btn"
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
            </div>
            <p class="detail-muted">
              {t.workflows.internalIds}: <code>{state.id}</code> / <code>{state.runId}</code>
            </p>
            <ul class="detail-list">
              <li>
                {t.workflows.version}: {state.version}
              </li>
              <li>
                {t.workflows.diagnostics}: pendientes=
                {state.pendingActivities.length + state.pendingTimers.length + (state.pendingSignalWaits?.length ?? 0)}
                {" · "}
                {t.workflows.retries}={(events ?? []).filter((e) => e.type === "RetryAttemptStarted").length}
              </li>
              {events && events.length > 0 && (
                <li>
                  {t.workflows.lastEvent}: {events[events.length - 1]!.type}
                </li>
              )}
            </ul>
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
      </div>
    </div>
  );
}
