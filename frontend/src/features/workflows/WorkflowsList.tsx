import type { WorkflowSummary, WorkflowStatus } from "../../api/types";
import { useUiText } from "../../i18n";

interface Props {
    workflows: WorkflowSummary[] | null;
    loading: boolean;
    error: Error | null;
    selected: { workflowId: string; runId: string } | null;
    onSelect: (sel: { workflowId: string; runId: string }) => void;
    statusFilter: WorkflowStatus | "";
    onStatusFilterChange: (status: WorkflowStatus | "") => void;
    searchQuery: string;
    onSearchQueryChange: (q: string) => void;
    page: number;
    onPageChange: (page: number) => void;
}

export function WorkflowsList({ workflows, loading, error, selected, onSelect, statusFilter, onStatusFilterChange, searchQuery, onSearchQueryChange, page, onPageChange }: Props) {
  const { t } = useUiText();
  if (loading){
    return <div class="panel">{t.workflows.loadingList}</div>;
  } 
  if (error){
    return <div class="panel panel-error">Error: {error.message}</div>;
  }

  const filterOptions: { value: WorkflowStatus | ""; label: string }[] = [
    { value: "", label: t.workflows.filterAll },
    { value: "running", label: "Running" },
    { value: "completed", label: "Completed" },
    { value: "failed", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "pending", label: "Pending" },
  ];

  const q = searchQuery.trim().toLowerCase();
  const filteredWorkflows =
    !workflows ? [] : q === ""
      ? workflows
      : workflows.filter(
          (w) =>
            (w.name ?? "").toLowerCase().includes(q) ||
            (w.workflowId ?? "").toLowerCase().includes(q) ||
            (w.runId ?? "").toLowerCase().includes(q)
  );

  return (
    <div class="panel">
      <h2 class="panel-title">{t.workflows.title}</h2>
      <div class="workflow-filter">
        {filterOptions.map(({ value, label }) => (
          <button
            key={value || "all"}
            type="button"
            class={`workflow-filter-btn ${statusFilter === value ? "workflow-filter-btn--active" : ""}`}
            onClick={() => onStatusFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div class="workflow-search-wrap">
        <input
          type="text"
          class="workflow-search-input"
          placeholder={t.workflows.searchPlaceholder}
          value={searchQuery}
          onInput={(e) => onSearchQueryChange((e.target as HTMLInputElement).value)}
        />
      </div>
      {(!workflows || workflows.length === 0) ? (
        <p class="workflow-list-empty">
          {statusFilter ? t.workflows.emptyWithStatus(statusFilter) : t.workflows.empty}
        </p>
      ) : filteredWorkflows.length === 0 ? (
        <p class="workflow-list-empty">
          {t.workflows.noneMatchSearch}
        </p>
      ) : (
        <ul class="workflow-list">
          {filteredWorkflows.map((w) => {
            const isSelected =
              selected?.workflowId === w.workflowId && selected?.runId === w.runId;
            return (
              <li
                key={`${w.workflowId}-${w.runId}`}
                class={`workflow-list-item ${isSelected ? "selected" : ""}`}
                onClick={() => onSelect({ workflowId: w.workflowId, runId: w.runId })}
              >
                <div class="workflow-name">{w.name}</div>
                <div class={`workflow-status status-${w.status}`}>{w.status}</div>
                <div class="workflow-meta">
                  <span>{w.startedAt ?? t.workflows.noDate}</span>
                  {typeof w.pendingSignalWaits === "number" && w.pendingSignalWaits > 0 ? (
                    <span>
                      {" · "}
                      {t.workflows.signals}: {w.pendingSignalWaits}
                    </span>
                  ) : null}
                  {typeof w.retryAttempts === "number" && w.retryAttempts > 0 ? (
                    <span>
                      {" · "}
                      {t.workflows.retries}: {w.retryAttempts}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}