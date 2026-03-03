import type { WorkflowDefinition } from "../core/ftn";

type WorkflowMap = Map<string, WorkflowDefinition<any, any>>;

const workflows: WorkflowMap = new Map();

export function registerWorkflow<TInput, TResult>(name: string, def: WorkflowDefinition<TInput, TResult>): void {
  workflows.set(name, def as WorkflowDefinition<any, any>);
}

export function getWorkflow(name: string): WorkflowDefinition<any, any> | undefined {
  return workflows.get(name);
}

export interface SendWelcomeEmailInput {
    userId: string;
    email: string;
}
  
export interface SendWelcomeEmailResult {
    success: boolean;
}

export const sendWelcomeEmailWorkflow: WorkflowDefinition<SendWelcomeEmailInput, SendWelcomeEmailResult> = async (ftn, input) => {
    ftn.activity<SendWelcomeEmailInput, void>("send-welcome-email", input);
    return { success: true };
}

registerWorkflow("send-welcome-email", sendWelcomeEmailWorkflow);