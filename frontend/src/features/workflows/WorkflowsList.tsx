import type { WorkflowSummary, WorkflowStatus } from "../../api/types";

interface Props {
    workflows: WorkflowSummary[] | null;
    loading: boolean;
    error: Error | null;
    selected: { workflowId: string; runId: string } | null;
    onSelect: (sel: { workflowId: string; runId: string }) => void;
    statusFilter: WorkflowStatus | "";
    onStatusFilterChange: (status: WorkflowStatus | "") => void;
}

export function WorkflowsList({ workflows, loading, error, selected, onSelect, statusFilter, onStatusFilterChange }: Props) {
  if (loading){
    return <div class="panel">Cargando workflows…</div>;
  } 
  if (error){
    return <div class="panel panel-error">Error: {error.message}</div>;
  }

  const filterOptions: { value: WorkflowStatus | ""; label: string }[] = [
    { value: "", label: "Todos" },
    { value: "running", label: "Running" },
    { value: "completed", label: "Completed" },
    { value: "failed", label: "Failed" },
    { value: "pending", label: "Pending" },
  ];

  return (
    <div class="panel">
      <h2 class="panel-title">Workflows</h2>
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
      {(!workflows || workflows.length === 0) ? (
        <p class="workflow-list-empty">
          {statusFilter ? `No hay workflows con estado "${statusFilter}".` : "No hay workflows aún."}
        </p>
      ) : (
        <ul class="workflow-list">
          {workflows.map((w) => {
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
                  <span>{w.startedAt ?? "sin fecha"}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}