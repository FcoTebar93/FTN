export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpWorkflowTrigger {
  type: "http";
  key: string;
  method: HttpMethod;
  path: string;
  workflowName: string;
  useBodyAsInput?: boolean;
}

export type WorkflowTrigger = HttpWorkflowTrigger;

const triggers: WorkflowTrigger[] = [];

triggers.push({
  type: "http",
  key: "signup-form-submitted",
  method: "POST",
  path: "/triggers/payment-signup",
  workflowName: "payment-signup",
  useBodyAsInput: true,
});

export function matchHttpTrigger(method: string, path: string): HttpWorkflowTrigger | undefined {
  const m = method.toUpperCase();
  return triggers.find(
    (t) => t.type === "http" && t.method === m && t.path === path
  ) as HttpWorkflowTrigger | undefined;
}