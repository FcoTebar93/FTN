import type { WorkflowDefinition } from "../core/ftn";
import { GenerateQrCodeInput, SendEmailInput } from "./activity-types";

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

export interface PaymentSignupInput {
  email: string;
  planName: string;
  priceCents: number;
}

export interface PaymentSignupResult {
  email: string;
  sessionId: string;
}

export const orderProcessingWorkflow: WorkflowDefinition<OrderInput, OrderResult> = async (ftn, input) => {
  const validateHandle = ftn.activity<OrderInput, void>("validate-order", input);
  const shipmentHandle = ftn.activity<OrderInput, void>("create-shipment", input);

  await ftn.retry(
    { maxAttempts: 3, backOffMs: 500 },
    async (attempt) => {
      const chargeHandle = ftn.activity<OrderInput, void>("charge-payment", input, attempt);
      await ftn.join([chargeHandle]);
    }
  );

  await ftn.join([validateHandle, shipmentHandle]);
  return { orderId: input.orderId, charged: true, shipped: true };
};

export const paymentSignupWorkflow: WorkflowDefinition<PaymentSignupInput, PaymentSignupResult> =
  async (ftn, input) => {
    const qrHandle = ftn.activity<GenerateQrCodeInput, string>("generate-qr-code", {
      data: `https://tu-front/pagar?email=${encodeURIComponent(input.email)}`,
      size: 256,
      format: "png",
    });
    const emailHandle = ftn.activity<SendEmailInput, void>("send-email", {
      to: input.email,
      subject: "Completa tu pago",
      htmlBody: `<p>Escanea este código para pagar:</p><img src="${(await ftn.join([qrHandle]))[0]}" />`,
    });
    await ftn.join([emailHandle]);
    const payment = await ftn.signal<PaymentSignupResult>("payment-completed");
    await ftn.activity("db-execute", {
      sql: "insert into users(email, stripe_session_id, created_at) values ($1, $2, now())",
      params: [input.email, payment.sessionId],
    });
    return {
      email: input.email,
      sessionId: payment.sessionId,
    };
}; 

registerWorkflow<OrderInput, OrderResult>(
  "order-processing",
  orderProcessingWorkflow
);

registerWorkflow<PaymentSignupInput, PaymentSignupResult>(
  "payment-signup",
  paymentSignupWorkflow
);