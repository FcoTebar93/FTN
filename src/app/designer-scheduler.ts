import type { ExecutionSchedule, StoredWorkflow } from "./designer-types";
import { shouldFireScheduledWorkflow } from "./designer-schedule";

export interface DesignerSchedulerDeps {
  listSchedulerRows: () => Promise<Array<{ id: string; payload: StoredWorkflow; lastRun: Date | null }>>;
  recordScheduledRun: (id: string, at: Date) => Promise<void>;
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
      await deps.startWorkflow(row.id, row.payload.scheduledInput ?? {});
      await deps.recordScheduledRun(row.id, now);
    } catch (e) {
      deps.log.error("designer.scheduler", { id: row.id, err: String(e) });
    }
  }
}
