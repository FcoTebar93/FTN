import type { JsonSchema } from "../shared/json-schema";

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
    description: "Ejecuta una activity registrada en el motor.",
    fields: [
      { name: "activityName", label: "Activity", type: "activity-select", required: true },
      { name: "input", label: "Input JSON", type: "json" },
    ],
  },
  {
    id: "sleep",
    label: "Sleep",
    description: "Pausa la ejecución durante un tiempo.",
    fields: [
      { name: "milliseconds", label: "Milisegundos", type: "number", required: true, min: 0 },
    ],
  },
  {
    id: "signal",
    label: "Signal",
    description: "Espera a recibir una señal externa.",
    fields: [
      { name: "signalName", label: "Nombre de la señal", type: "string", required: true },
    ],
  },
];