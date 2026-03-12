export type DesignerFieldType = "string" | "number" | "boolean" | "json" | "activity-select";

export interface DesignerKindField {
  name: string;
  label: string;
  type: DesignerFieldType;
  required?: boolean;
  description?: string;
  min?: number;
  max?: number;
}

export interface DesignerKind {
  id: "activity" | "sleep" | "signal";
  label: string;
  description?: string;
  fields: DesignerKindField[];
}

export const DESIGNER_KINDS: DesignerKind[] = [
  {
    id: "activity",
    label: "Activity",
    description: "Executes a registered activity in the engine.",
    fields: [
      { name: "activityName", label: "Activity", type: "activity-select", required: true },
      { name: "input", label: "Input JSON", type: "json" },
    ],
  },
  {
    id: "sleep",
    label: "Sleep",
    description: "Pauses the execution for a period of time.",
    fields: [
      { name: "milliseconds", label: "Milisegundos", type: "number", required: true, min: 0 },
    ],
  },
  {
    id: "signal",
    label: "Signal",
    description: "Waits for an external signal.",
    fields: [
      { name: "signalName", label: "Signal name", type: "string", required: true },
    ],
  },
];