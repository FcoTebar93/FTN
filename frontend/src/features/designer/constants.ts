import type { DesignerWeekday } from "../../api/types";

export const TIMEZONES = [
  "UTC",
  "Europe/Madrid",
  "Europe/London",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/New_York",
] as const;

export const WEEKDAY_LABELS: { value: DesignerWeekday; label: string }[] = [
  { value: 0, label: "Lun" },
  { value: 1, label: "Mar" },
  { value: 2, label: "Mié" },
  { value: 3, label: "Jue" },
  { value: 4, label: "Vie" },
  { value: 5, label: "Sáb" },
  { value: 6, label: "Dom" },
];
