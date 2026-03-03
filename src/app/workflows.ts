import type { WorkflowDefinition } from "../core/ftn";

const workflows = new Map<string, WorkflowDefinition<any, any>>();

export function registerWorkflow<TInput, TResult>(name: string, def: WorkflowDefinition<TInput, TResult>): void {
  workflows.set(name, def as WorkflowDefinition<any, any>);
}

export function getWorkflow(name: string): WorkflowDefinition<any, any> | undefined {
  return workflows.get(name);
}