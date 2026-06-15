import type { WorkflowEvent, WorkflowState, StepRecord } from "../../api/types";

const EVENT_LABELS_ES: Record<string, string> = {
  WorkflowStarted: "Proceso iniciado",
  WorkflowCompleted: "Proceso completado",
  WorkflowFailed: "Proceso fallido",
  WorkflowCancelled: "Proceso cancelado",
  ActivityScheduled: "Tarea programada",
  ActivityStarted: "Tarea en curso",
  ActivityCompleted: "Tarea completada",
  ActivityFailed: "Tarea fallida",
  TimerScheduled: "Espera programada",
  TimerFired: "Espera finalizada",
  SignalReceived: "Confirmación recibida",
  SignalWaitStarted: "Esperando confirmación",
  RetryAttemptStarted: "Reintento",
  StepForked: "Rama iniciada",
  StepJoined: "Ramas unidas",
};

export function friendlyEventLabel(type: string, locale: "es" | "en"): string {
  if (locale === "en") return type;
  return EVENT_LABELS_ES[type] ?? type.replace(/([A-Z])/g, " $1").trim();
}

export function friendlyStatus(status: string, locale: "es" | "en"): string {
  const mapEs: Record<string, string> = {
    running: "En curso",
    completed: "Completado",
    failed: "Fallido",
    cancelled: "Cancelado",
    pending: "Pendiente",
    waiting: "En espera",
    idle: "Sin iniciar",
  };
  if (locale === "en") return status;
  return mapEs[status] ?? status;
}

export function buildAuthorTimeline(
  events: WorkflowEvent[] | null,
  steps: StepRecord[] | null,
  locale: "es" | "en"
): Array<{ at: string; label: string; detail?: string; tone: "ok" | "wait" | "fail" | "neutral" }> {
  const items: Array<{ at: string; label: string; detail?: string; tone: "ok" | "wait" | "fail" | "neutral" }> = [];
  const sorted = events ? [...events].sort((a, b) => a.version - b.version || a.startedAt.localeCompare(b.startedAt)) : [];

  for (const ev of sorted) {
    if (["WorkflowStarted", "ActivityCompleted", "ActivityFailed", "SignalReceived", "TimerFired", "WorkflowCompleted", "WorkflowFailed", "WorkflowCancelled"].includes(ev.type)) {
      const payload = ev.payload as Record<string, unknown> | null;
      const name = typeof payload?.name === "string" ? payload.name : undefined;
      items.push({
        at: ev.startedAt,
        label: name ? `${friendlyEventLabel(ev.type, locale)}: ${name}` : friendlyEventLabel(ev.type, locale),
        tone: ev.type.includes("Failed") ? "fail" : ev.type.includes("Completed") || ev.type === "SignalReceived" ? "ok" : "neutral",
      });
    }
  }

  if (steps) {
    for (const s of steps) {
      if (s.status === "waiting" || s.status === "running") {
        const label = s.activityName ?? s.id;
        if (!items.some((i) => i.label.includes(label))) {
          items.push({
            at: "",
            label: locale === "es" ? `Paso en curso: ${label}` : `Step in progress: ${label}`,
            tone: "wait",
          });
        }
      }
    }
  }

  return items;
}

export function authorRunSummary(state: WorkflowState, locale: "es" | "en"): string[] {
  const lines: string[] = [];
  const pendingSignals = state.pendingSignalWaits?.length ?? 0;
  const pendingActivities = state.pendingActivities.length;
  const pendingTimers = state.pendingTimers.length;

  if (locale === "es") {
    if (pendingSignals > 0) lines.push(`Esperando ${pendingSignals} confirmación(es) externa(s)`);
    if (pendingActivities > 0) lines.push(`${pendingActivities} tarea(s) en curso`);
    if (pendingTimers > 0) lines.push(`${pendingTimers} espera(s) programada(s)`);
    if (lines.length === 0 && state.status === "running") lines.push("El proceso avanza con normalidad");
    if (state.status === "completed") lines.push("Proceso finalizado correctamente");
    if (state.status === "failed" && state.failureReason) lines.push(`Error: ${state.failureReason}`);
  } else {
    if (pendingSignals > 0) lines.push(`Waiting for ${pendingSignals} external signal(s)`);
    if (pendingActivities > 0) lines.push(`${pendingActivities} task(s) in progress`);
    if (pendingTimers > 0) lines.push(`${pendingTimers} scheduled wait(s)`);
    if (lines.length === 0 && state.status === "running") lines.push("Process is running normally");
    if (state.status === "completed") lines.push("Process completed successfully");
    if (state.status === "failed" && state.failureReason) lines.push(`Error: ${state.failureReason}`);
  }
  return lines;
}
