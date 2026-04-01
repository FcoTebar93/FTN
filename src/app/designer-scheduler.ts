import type { ExecutionSchedule, StoredWorkflow } from "./designer-types";
import { shouldFireScheduledWorkflow } from "./designer-schedule";

export interface DesignerSchedulerDeps {
  listSchedulerRows: () => Promise<Array<{ subject: string; id: string; runtimeName: string; payload: StoredWorkflow; lastRun: Date | null; lastError: string | null }>>;
  recordScheduledRun: (subject: string, id: string, at: Date) => Promise<void>;
  recordScheduledFailure: (subject: string, id: string, error: string) => Promise<void>;
  startWorkflow: (name: string, input: unknown) => Promise<void>;
  log: { error: (msg: string, meta?: Record<string, unknown>) => void };
}

export async function runScheduledWorkflowTick(deps: DesignerSchedulerDeps): Promise<void> {
  const rows = await deps.listSchedulerRows();
  const now = new Date();
  for (const row of rows) {
    const schedule: ExecutionSchedule = row.payload.schedule ?? { type: "instant" };
    if (schedule.type === "instant") {
      continue;
    }
    if (!shouldFireScheduledWorkflow(schedule, row.lastRun, now)) {
      continue;
    }
    try {
      await deps.startWorkflow(row.runtimeName, row.payload.scheduledInput ?? {});
      await deps.recordScheduledRun(row.subject, row.id, now);
    } catch (e) {
      await deps.recordScheduledFailure(row.subject, row.id, String((e as Error).message ?? e));
      deps.log.error("designer.scheduler", { subject: row.subject, id: row.id, err: String(e) });
    }
  }
}
