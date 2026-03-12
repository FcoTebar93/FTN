import type { StoredWorkflow } from "./designer-types";
import { buildWorkflowDefinitionFromStored } from "./designer-runtime";
import { registerWorkflow } from "./workflows";

const store = new Map<string, StoredWorkflow>();

export function listStoredWorkflows(): Array<Pick<StoredWorkflow, "id" | "version" | "displayName" | "description" | "tags">> {
  return Array.from(store.values()).map((w) => ({
    id: w.id,
    version: w.version,
    displayName: w.displayName,
    description: w.description,
    tags: w.tags,
  }));
}

export function getStoredWorkflow(id: string): StoredWorkflow | undefined {
  return store.get(id);
}

export function upsertStoredWorkflow(w: StoredWorkflow): void {
  store.set(w.id, w);

  const definition = buildWorkflowDefinitionFromStored(w);

  registerWorkflow({
    name: w.id,
    version: w.version,
    displayName: w.displayName,
    description: w.description,
    tags: w.tags,
    inputSchema: w.inputSchema,
    resultSchema: w.resultSchema,
    definition,
  });
}