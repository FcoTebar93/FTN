import type { WorkflowState, WorkflowEvent, StepRecord } from "../../api/types";

interface Props {
  selected: { workflowId: string; runId: string } | null;
  state: WorkflowState | null;
  events: WorkflowEvent[] | null;
  steps: StepRecord[] | null;
  loading: boolean;
  error: Error | null;
}

export function WorkflowDetail({ selected, state, events, steps, loading, error }: Props) {
  if (!selected) {
    return <div class="panel">Selecciona un workflow para ver el detalle.</div>;
  }

  if (loading) return <div class="panel">Cargando detalle…</div>;
  if (error) return <div class="panel panel-error">Error: {error.message}</div>;
  if (!state) return <div class="panel">No se ha encontrado el estado.</div>;

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

      {/* Aquí luego puedes convertir en tabs */}
      <section class="workflow-section">
        <h3>Actividades</h3>
        <pre>{JSON.stringify({ pending: state.pendingActivities, completed: state.completedActivities }, null, 2)}</pre>
      </section>

      <section class="workflow-section">
        <h3>Timers</h3>
        <pre>{JSON.stringify(state.pendingTimers, null, 2)}</pre>
      </section>

      <section class="workflow-section">
        <h3>Steps</h3>
        <pre>{JSON.stringify(steps ?? [], null, 2)}</pre>
      </section>

      <section class="workflow-section">
        <h3>Eventos</h3>
        <pre>{JSON.stringify(events ?? [], null, 2)}</pre>
      </section>
    </div>
  );
}