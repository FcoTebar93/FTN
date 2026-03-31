import type { DesignerExecutionSchedule } from "../../api/types";

export function formatHM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseHM(s: string): { hour: number; minute: number } {
  const [a, b] = s.split(":");
  const hour = Number(a);
  const minute = Number(b);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return { hour: 9, minute: 0 };
  return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
}

export function scheduleSummary(s?: DesignerExecutionSchedule): string {
  if (!s || s.type === "instant") return "Instantánea";
  if (s.type === "daily") return `Diaria ${formatHM(s.hour, s.minute)} (${s.timezone ?? "UTC"})`;
  return `Semanal ${formatHM(s.hour, s.minute)} · ${s.weekdays.length} día(s)`;
}

function defaultValueBySchemaType(type?: string | string[]): unknown {
  const t = Array.isArray(type) ? type[0] : type;
  if (t === "number" || t === "integer") return 0;
  if (t === "boolean") return false;
  if (t === "array") return [];
  if (t === "object") return {};
  return "";
}

export function buildDefaultInputFromSchema(schema?: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const s = schema as { type?: string | string[]; properties?: Record<string, { type?: string | string[] }> };
  if (s.type !== "object" || !s.properties) return {};
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(s.properties)) {
    defaults[key] = defaultValueBySchemaType(prop?.type);
  }
  return defaults;
}
