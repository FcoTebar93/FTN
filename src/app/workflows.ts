import type { WorkflowDefinition } from "../core/ftn";

type WorkflowMap = Map<string, WorkflowDefinition<any, any>>;

const workflows: WorkflowMap = new Map();

export function registerWorkflow<TInput, TResult>(name: string,definition: WorkflowDefinition<TInput, TResult>): void {
  workflows.set(name, definition as WorkflowDefinition<any, any>);
}

export function getWorkflow(name: string): WorkflowDefinition<any, any> | undefined {
  return workflows.get(name);
}

export interface OrderInput {
  orderId: string;
  userId: string;
  amount: number;
}

export interface OrderResult {
  orderId: string;
  charged: boolean;
  shipped: boolean;
}

export const orderProcessingWorkflow: WorkflowDefinition<OrderInput, OrderResult> = async (ftn, input) => {
  const validateHandle = ftn.activity<OrderInput, void>("validate-order", input);
  const shipmentHandle = ftn.activity<OrderInput, void>("create-shipment", input);

  await ftn.retry(
    { maxAttempts: 3 },
    async (attempt) => {
      const chargeHandle = ftn.activity<OrderInput, void>("charge-payment", input, attempt);
      await ftn.join([chargeHandle]);
    }
  );

  await ftn.join([validateHandle, shipmentHandle]);
  return { orderId: input.orderId, charged: true, shipped: true };
};

registerWorkflow<OrderInput, OrderResult>(
  "order-processing",
  orderProcessingWorkflow
);