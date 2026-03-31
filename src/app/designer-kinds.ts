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
  id: "activity" | "sleep" | "signal" | "conditional" | "parallel";
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
  {
    id: "conditional",
    label: "Conditional",
    description: "Ejecuta una rama u otra según una expresión.",
    fields: [
      {
        name: "expression",
        label: "Expression",
        type: "string",
        required: true,
        description: "Ej: input.amount > 1000",
      },
      {
        name: "thenNext",
        label: "Then step id",
        type: "string",
        description: "Id del siguiente step si la condición es verdadera",
      },
      {
        name: "elseNext",
        label: "Else step id",
        type: "string",
        description: "Id del siguiente step si la condición es falsa",
      },
    ],
  },
  {
    id: "parallel",
    label: "Parallel",
    description: "Ejecuta varias ramas en paralelo.",
    fields: [
      {
        name: "branches",
        label: "Branches (JSON)",
        type: "json",
        description: "Array de arrays de ids de steps, p.ej. [[\"s1\",\"s2\"],[\"s3\"]]",
      },
    ],
  }
];