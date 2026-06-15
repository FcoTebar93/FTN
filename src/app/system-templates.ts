import type { StoredWorkflow } from "./designer-types";
import templatesData from "./data/system-workflow-templates.json";

export interface SystemTemplateDefinition {
  id: string;
  label: string;
  description: string;
  requiredActivities: string[];
  payload: StoredWorkflow;
}

const SYSTEM_TEMPLATES: SystemTemplateDefinition[] = templatesData as unknown as SystemTemplateDefinition[];

export function listSystemTemplates(): Array<
  Pick<SystemTemplateDefinition, "id" | "label" | "description" | "requiredActivities">
> {
  return SYSTEM_TEMPLATES.map(({ id, label, description, requiredActivities }) => ({
    id,
    label,
    description,
    requiredActivities,
  }));
}

export function getSystemTemplate(id: string): SystemTemplateDefinition | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.id === id);
}

export function getSystemTemplatePayload(id: string): StoredWorkflow | undefined {
  const tpl = getSystemTemplate(id);
  if (!tpl) return undefined;
  return structuredClone(tpl.payload);
}
