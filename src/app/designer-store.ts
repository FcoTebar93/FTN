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

export function getDesignerRuntimeName(subject: string, id: string): string {
  return `${subject}::${id}`;
}

function memKey(subject: string, id: string): string {
  return `${subject}::${id}`;
}

function registerOne(subject: string, w: StoredWorkflow): void {
  const normalized = normalizeStoredWorkflow(w);
  const definition = buildWorkflowDefinitionFromStored(normalized);
  registerWorkflow({
    name: getDesignerRuntimeName(subject, normalized.id),
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
    subject: string;
    id: string;
    payload: unknown;
    last_scheduled_run_at: Date | null;
  }>(`SELECT subject, id, payload, last_scheduled_run_at FROM ftn_designer_workflows ORDER BY subject, id`);

  for (const row of rows) {
    const payload = row.payload as StoredWorkflow;
    const normalized = normalizeStoredWorkflow(payload);
    memory.set(memKey(row.subject, row.id), normalized);
    if (row.last_scheduled_run_at) {
      memoryLastScheduled.set(memKey(row.subject, row.id), row.last_scheduled_run_at);
    }
    registerOne(row.subject, normalized);
  }
}

export async function upsertStoredWorkflow(subject: string, w: StoredWorkflow): Promise<void> {
  const normalized = normalizeStoredWorkflow(w);
  memory.set(memKey(subject, normalized.id), normalized);
  registerOne(subject, normalized);

  if (pool) {
    await pool.query(
      `INSERT INTO ftn_designer_workflows (subject, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (subject, id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [subject, normalized.id, JSON.stringify(normalized)]
    );
  }
}

export async function getStoredWorkflow(subject: string, id: string): Promise<StoredWorkflow | undefined> {
  const k = memKey(subject, id);
  if (memory.has(k)) {
    return memory.get(k);
  }
  if (pool) {
    const { rows } = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM ftn_designer_workflows WHERE subject = $1 AND id = $2`,
      [subject, id]
    );
    if (rows[0]) {
      const w = normalizeStoredWorkflow(rows[0].payload as StoredWorkflow);
      memory.set(k, w);
      return w;
    }
  }
  return undefined;
}

export type DesignerWorkflowListItem = Pick<
  StoredWorkflow,
  "id" | "version" | "displayName" | "description" | "tags"
> & { schedule: ExecutionSchedule };

export async function listStoredWorkflows(subject: string): Promise<DesignerWorkflowListItem[]> {
  if (pool) {
    const { rows } = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM ftn_designer_workflows WHERE subject = $1 ORDER BY id`,
      [subject]
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
  return Array.from(memory.entries())
    .filter(([k]) => k.startsWith(`${subject}::`))
    .map(([, w]) => {
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
  Array<{ subject: string; id: string; runtimeName: string; payload: StoredWorkflow; lastRun: Date | null }>
> {
  if (pool) {
    const { rows } = await pool.query<{
      subject: string;
      id: string;
      payload: unknown;
      last_scheduled_run_at: Date | null;
    }>(`SELECT subject, id, payload, last_scheduled_run_at FROM ftn_designer_workflows`);
    return rows.map((r) => ({
      subject: r.subject,
      id: r.id,
      runtimeName: getDesignerRuntimeName(r.subject, r.id),
      payload: normalizeStoredWorkflow(r.payload as StoredWorkflow),
      lastRun: r.last_scheduled_run_at,
    }));
  }
  return Array.from(memory.entries()).map(([k, w]) => {
    const sep = k.indexOf("::");
    const subject = sep >= 0 ? k.slice(0, sep) : "system";
    const id = sep >= 0 ? k.slice(sep + 2) : k;
    return {
    subject,
    id,
    runtimeName: getDesignerRuntimeName(subject, id),
    payload: normalizeStoredWorkflow(w),
    lastRun: memoryLastScheduled.get(k) ?? null,
  };});
}

export async function recordScheduledRun(subject: string, id: string, at: Date): Promise<void> {
  memoryLastScheduled.set(memKey(subject, id), at);
  if (pool) {
    await pool.query(
      `UPDATE ftn_designer_workflows SET last_scheduled_run_at = $3 WHERE subject = $1 AND id = $2`,
      [subject, id, at]
    );
  }
}
