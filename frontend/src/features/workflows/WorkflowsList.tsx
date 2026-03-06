import type { WorkflowSummary } from "../../api/types";

interface Props {
  workflows: WorkflowSummary[] | null;
  loading: boolean;
  error: Error | null;
  selected: { workflowId: string; runId: string } | null;
  onSelect: (sel: { workflowId: string; runId: string }) => void;
}

export function WorkflowsList({ workflows, loading, error, selected, onSelect }: Props) {
  if (loading) return <div class="panel">Cargando workflows…</div>;
  if (error) return <div class="panel panel-error">Error: {error.message}</div>;
  if (!workflows || workflows.length === 0) return <div class="panel">No hay workflows aún.</div>;

  return (
    <div class="panel">
      <h2 class="panel-title">Workflows</h2>
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
    </div>
  );
}