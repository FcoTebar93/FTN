import type { Pool } from "pg";
import type { ExecutionSchedule, StoredWorkflow } from "./designer-types";
import { buildWorkflowDefinitionFromStored } from "./designer-runtime";
import { registerWorkflow } from "./workflows";
import { normalizeStoredWorkflow } from "./designer-schedule";

let pool: Pool | undefined;
const memory = new Map<string, StoredWorkflow>();
const memoryLastScheduled = new Map<string, Date>();

export function configureDesignerStore(p: Pool | undefined): void {
  pool = p;
}

function registerOne(w: StoredWorkflow): void {
  const normalized = normalizeStoredWorkflow(w);
  const definition = buildWorkflowDefinitionFromStored(normalized);
  registerWorkflow({
    name: normalized.id,
    version: normalized.version,
    displayName: normalized.displayName,
    description: normalized.description,
    tags: normalized.tags ?? [],
    inputSchema: normalized.inputSchema,
    resultSchema: normalized.resultSchema,
    definition,
  });
}

export async function loadAllFromDatabase(): Promise<void> {
  if (!pool) {
    return;
  }
  const { rows } = await pool.query<{
    id: string;
    payload: unknown;
    last_scheduled_run_at: Date | null;
  }>(`SELECT id, payload, last_scheduled_run_at FROM ftn_designer_workflows ORDER BY id`);

  for (const row of rows) {
    const payload = row.payload as StoredWorkflow;
    const normalized = normalizeStoredWorkflow(payload);
    memory.set(row.id, normalized);
    if (row.last_scheduled_run_at) {
      memoryLastScheduled.set(row.id, row.last_scheduled_run_at);
    }
    registerOne(normalized);
  }
}

export async function upsertStoredWorkflow(w: StoredWorkflow): Promise<void> {
  const normalized = normalizeStoredWorkflow(w);
  memory.set(normalized.id, normalized);
  registerOne(normalized);

  if (pool) {
    await pool.query(
      `INSERT INTO ftn_designer_workflows (id, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [normalized.id, JSON.stringify(normalized)]
    );
  }
}

export async function getStoredWorkflow(id: string): Promise<StoredWorkflow | undefined> {
  if (memory.has(id)) {
    return memory.get(id);
  }
  if (pool) {
    const { rows } = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM ftn_designer_workflows WHERE id = $1`,
      [id]
    );
    if (rows[0]) {
      const w = normalizeStoredWorkflow(rows[0].payload as StoredWorkflow);
      memory.set(id, w);
      return w;
    }
  }
  return undefined;
}

export type DesignerWorkflowListItem = Pick<
  StoredWorkflow,
  "id" | "version" | "displayName" | "description" | "tags"
> & { schedule: ExecutionSchedule };

export async function listStoredWorkflows(): Promise<DesignerWorkflowListItem[]> {
  if (pool) {
    const { rows } = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM ftn_designer_workflows ORDER BY id`
    );
    return rows.map((r) => {
      const w = normalizeStoredWorkflow(r.payload as StoredWorkflow);
      return {
        id: w.id,
        version: w.version,
        displayName: w.displayName,
        description: w.description,
        tags: w.tags,
        schedule: w.schedule ?? { type: "instant" },
      };
    });
  }
  return Array.from(memory.values()).map((w) => {
    const n = normalizeStoredWorkflow(w);
    return {
      id: n.id,
      version: n.version,
      displayName: n.displayName,
      description: n.description,
      tags: n.tags,
      schedule: n.schedule ?? { type: "instant" },
    };
  });
}

export async function listSchedulerRows(): Promise<
  Array<{ id: string; payload: StoredWorkflow; lastRun: Date | null }>
> {
  if (pool) {
    const { rows } = await pool.query<{
      id: string;
      payload: unknown;
      last_scheduled_run_at: Date | null;
    }>(`SELECT id, payload, last_scheduled_run_at FROM ftn_designer_workflows`);
    return rows.map((r) => ({
      id: r.id,
      payload: normalizeStoredWorkflow(r.payload as StoredWorkflow),
      lastRun: r.last_scheduled_run_at,
    }));
  }
  return Array.from(memory.entries()).map(([id, w]) => ({
    id,
    payload: normalizeStoredWorkflow(w),
    lastRun: memoryLastScheduled.get(id) ?? null,
  }));
}

export async function recordScheduledRun(id: string, at: Date): Promise<void> {
  memoryLastScheduled.set(id, at);
  if (pool) {
    await pool.query(`UPDATE ftn_designer_workflows SET last_scheduled_run_at = $2 WHERE id = $1`, [id, at]);
  }
}
