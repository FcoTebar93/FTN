import type { Pool } from "pg";
import type { StoredWorkflow } from "./designer-types";
import { normalizeStoredWorkflow } from "./designer-schedule";
import { getSystemTemplate, getSystemTemplatePayload, listSystemTemplates } from "./system-templates";

let pool: Pool | undefined;
const memory = new Map<string, StoredTemplateRecord>();

export interface StoredTemplateRecord {
  id: string;
  label: string;
  description: string;
  sourceTemplateId: string | null;
  isCustom: boolean;
  payload: StoredWorkflow;
  updatedAt?: string;
}

export type DesignerTemplateListItem = Pick<
  StoredTemplateRecord,
  "id" | "label" | "description" | "sourceTemplateId" | "isCustom" | "updatedAt"
>;

function memKey(subject: string, id: string): string {
  return `${subject}::${id}`;
}

function payloadsEqual(a: StoredWorkflow, b: StoredWorkflow): boolean {
  return JSON.stringify(normalizeStoredWorkflow(a)) === JSON.stringify(normalizeStoredWorkflow(b));
}

export function configureDesignerTemplateStore(p: Pool | undefined): void {
  pool = p;
}

export async function loadAllTemplatesFromDatabase(): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query<{
    id: string;
    subject: string;
    source_template_id: string | null;
    is_custom: boolean;
    label: string;
    description: string;
    payload: unknown;
    updated_at: Date;
  }>(`SELECT subject, id, source_template_id, is_custom, label, description, payload, updated_at
      FROM ftn_designer_templates ORDER BY subject, id`);

  for (const row of rows) {
    const record: StoredTemplateRecord = {
      id: row.id,
      label: row.label,
      description: row.description,
      sourceTemplateId: row.source_template_id,
      isCustom: row.is_custom,
      payload: normalizeStoredWorkflow(row.payload as StoredWorkflow),
      updatedAt: row.updated_at.toISOString(),
    };
    memory.set(memKey(row.subject, row.id), record);
  }
}

async function upsertTemplateRecord(subject: string, record: StoredTemplateRecord): Promise<void> {
  memory.set(memKey(subject, record.id), record);
  if (pool) {
    await pool.query(
      `INSERT INTO ftn_designer_templates
         (subject, id, source_template_id, is_custom, label, description, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
       ON CONFLICT (subject, id) DO UPDATE SET
         source_template_id = EXCLUDED.source_template_id,
         is_custom = EXCLUDED.is_custom,
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [
        subject,
        record.id,
        record.sourceTemplateId,
        record.isCustom,
        record.label,
        record.description,
        JSON.stringify(record.payload),
      ]
    );
  }
}

function buildSeedRecord(systemId: string): StoredTemplateRecord | undefined {
  const sys = getSystemTemplate(systemId);
  if (!sys) return undefined;
  const payload = structuredClone(sys.payload);
  return {
    id: sys.id,
    label: sys.label,
    description: sys.description,
    sourceTemplateId: sys.id,
    isCustom: false,
    payload: normalizeStoredWorkflow(payload),
  };
}

export async function ensureUserTemplatesSeeded(subject: string): Promise<void> {
  const count = await countUserTemplates(subject);
  if (count > 0) return;

  for (const sys of listSystemTemplates()) {
    const record = buildSeedRecord(sys.id);
    if (record) {
      await upsertTemplateRecord(subject, record);
    }
  }
}

async function countUserTemplates(subject: string): Promise<number> {
  if (pool) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ftn_designer_templates WHERE subject = $1`,
      [subject]
    );
    return Number(rows[0]?.n ?? 0);
  }
  return Array.from(memory.keys()).filter((k) => k.startsWith(`${subject}::`)).length;
}

export async function listUserTemplates(subject: string): Promise<DesignerTemplateListItem[]> {
  await ensureUserTemplatesSeeded(subject);

  if (pool) {
    const { rows } = await pool.query<{
      id: string;
      source_template_id: string | null;
      is_custom: boolean;
      label: string;
      description: string;
      updated_at: Date;
    }>(
      `SELECT id, source_template_id, is_custom, label, description, updated_at
       FROM ftn_designer_templates WHERE subject = $1 ORDER BY label, id`,
      [subject]
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      sourceTemplateId: r.source_template_id,
      isCustom: r.is_custom,
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  return Array.from(memory.entries())
    .filter(([k]) => k.startsWith(`${subject}::`))
    .map(([, r]) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      sourceTemplateId: r.sourceTemplateId,
      isCustom: r.isCustom,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getUserTemplate(subject: string, id: string): Promise<StoredTemplateRecord | undefined> {
  await ensureUserTemplatesSeeded(subject);
  const k = memKey(subject, id);
  if (memory.has(k)) return memory.get(k);

  if (pool) {
    const { rows } = await pool.query<{
      source_template_id: string | null;
      is_custom: boolean;
      label: string;
      description: string;
      payload: unknown;
      updated_at: Date;
    }>(
      `SELECT source_template_id, is_custom, label, description, payload, updated_at
       FROM ftn_designer_templates WHERE subject = $1 AND id = $2`,
      [subject, id]
    );
    if (rows[0]) {
      const record: StoredTemplateRecord = {
        id,
        label: rows[0].label,
        description: rows[0].description,
        sourceTemplateId: rows[0].source_template_id,
        isCustom: rows[0].is_custom,
        payload: normalizeStoredWorkflow(rows[0].payload as StoredWorkflow),
        updatedAt: rows[0].updated_at.toISOString(),
      };
      memory.set(k, record);
      return record;
    }
  }
  return undefined;
}

export async function upsertUserTemplate(
  subject: string,
  id: string,
  payload: StoredWorkflow,
  meta?: { label?: string; description?: string }
): Promise<StoredTemplateRecord> {
  const existing = await getUserTemplate(subject, id);
  const systemPayload = getSystemTemplatePayload(id);
  const normalized = normalizeStoredWorkflow({ ...payload, id });
  const isCustom = systemPayload ? !payloadsEqual(normalized, systemPayload) : true;

  const record: StoredTemplateRecord = {
    id,
    label: meta?.label ?? existing?.label ?? normalized.displayName,
    description: meta?.description ?? existing?.description ?? normalized.description ?? "",
    sourceTemplateId: existing?.sourceTemplateId ?? (getSystemTemplate(id) ? id : null),
    isCustom,
    payload: normalized,
    updatedAt: new Date().toISOString(),
  };
  await upsertTemplateRecord(subject, record);
  return record;
}

export async function restoreUserTemplate(subject: string, id: string): Promise<StoredTemplateRecord | undefined> {
  const seed = buildSeedRecord(id);
  if (!seed) return undefined;
  await upsertTemplateRecord(subject, seed);
  return seed;
}

export function workflowFromTemplate(
  templatePayload: StoredWorkflow,
  opts: { id: string; displayName?: string }
): StoredWorkflow {
  const wf = structuredClone(templatePayload);
  wf.id = opts.id;
  if (opts.displayName) wf.displayName = opts.displayName;
  return normalizeStoredWorkflow(wf);
}
