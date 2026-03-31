import type { ExecutionSchedule, StoredWorkflow, Weekday } from "./designer-types";

const DEFAULT_TZ = "UTC";

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

const SHORT_TO_WEEKDAY: Record<string, Weekday> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function formatDateKeyInTz(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date);
}

export function getZonedParts(
  date: Date,
  timeZone: string
): { hour: number; minute: number; weekday: Weekday } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }
  const hour = parseInt(map.hour ?? "0", 10);
  const minute = parseInt(map.minute ?? "0", 10);
  const wd = SHORT_TO_WEEKDAY[map.weekday ?? "Mon"] ?? 0;
  return { hour, minute, weekday: wd };
}

function sameCalendarDay(a: Date, b: Date, tz: string): boolean {
  return formatDateKeyInTz(a, tz) === formatDateKeyInTz(b, tz);
}

export function normalizeSchedule(raw: unknown): ExecutionSchedule {
  if (!raw || typeof raw !== "object") {
    return { type: "instant" };
  }
  const o = raw as Record<string, unknown>;
  if (o.type === "instant") {
    return { type: "instant" };
  }
  if (o.type === "daily") {
    const hour = clamp(Number(o.hour), 0, 23);
    const minute = clamp(Number(o.minute), 0, 59);
    const timezone = typeof o.timezone === "string" && o.timezone.trim() ? o.timezone.trim() : DEFAULT_TZ;
    return { type: "daily", hour, minute, timezone };
  }
  if (o.type === "weekly") {
    const rawWd = Array.isArray(o.weekdays) ? o.weekdays : [];
    const weekdays = [...new Set(rawWd.map((x) => clamp(Number(x), 0, 6) as Weekday))].filter((d) => d >= 0 && d <= 6);
    const hour = clamp(Number(o.hour), 0, 23);
    const minute = clamp(Number(o.minute), 0, 59);
    const timezone = typeof o.timezone === "string" && o.timezone.trim() ? o.timezone.trim() : DEFAULT_TZ;
    return { type: "weekly", weekdays, hour, minute, timezone };
  }
  return { type: "instant" };
}

export function normalizeStoredWorkflow(w: StoredWorkflow): StoredWorkflow {
  const schedule = normalizeSchedule(w.schedule);
  return {
    ...w,
    schedule,
    scheduledInput: w.scheduledInput === undefined ? {} : w.scheduledInput,
  };
}

export function validateSchedule(schedule: ExecutionSchedule): string | null {
  if (schedule.type === "instant") {
    return null;
  }
  if (schedule.type === "daily") {
    if (schedule.hour < 0 || schedule.hour > 23 || schedule.minute < 0 || schedule.minute > 59) {
      return "Hora diaria inválida (hora 0–23, minuto 0–59)";
    }
    return null;
  }
  if (schedule.type === "weekly") {
    if (!schedule.weekdays.length) {
      return "En modo semanal debes elegir al menos un día";
    }
    if (schedule.hour < 0 || schedule.hour > 23 || schedule.minute < 0 || schedule.minute > 59) {
      return "Hora semanal inválida";
    }
    return null;
  }
  return null;
}

export function shouldFireScheduledWorkflow(
  schedule: ExecutionSchedule,
  lastRun: Date | null,
  now: Date
): boolean {
  if (schedule.type === "instant") {
    return false;
  }
  const tz = schedule.timezone ?? DEFAULT_TZ;
  const parts = getZonedParts(now, tz);
  if (parts.hour !== schedule.hour || parts.minute !== schedule.minute) {
    return false;
  }

  if (schedule.type === "daily") {
    if (lastRun && sameCalendarDay(lastRun, now, tz)) {
      return false;
    }
    return true;
  }

  if (schedule.type === "weekly") {
    if (!schedule.weekdays.includes(parts.weekday)) {
      return false;
    }
    if (lastRun && sameCalendarDay(lastRun, now, tz)) {
      return false;
    }
    return true;
  }

  return false;
}
