import type { WorkflowDefinition } from "../core/ftn";
import { GenerateQrCodeInput, PaymentCompletedSignalData, SendEmailInput } from "./activity-types";

type WorkflowMap = Map<string, WorkflowDefinition<any, any>>;

const workflows: WorkflowMap = new Map();

export function registerWorkflow<TInput, TResult>(
  name: string,
  definition: WorkflowDefinition<TInput, TResult>
): void {
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

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "http://localhost:5173";

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

export const paymentSignupWorkflow: WorkflowDefinition<PaymentSignupInput, PaymentSignupResult> = async (ftn, input) => {
  const url = new URL("/pagar", FRONTEND_BASE_URL);
  url.searchParams.set("email", input.email);
  url.searchParams.set("planName", input.planName);
  url.searchParams.set("priceCents", String(input.priceCents));

  const qrHandle = ftn.activity<GenerateQrCodeInput, string>("generate-qr-code", {
    data: url.toString(),
    size: 256,
    format: "png",
  });

  const [qrUrl] = await ftn.join([qrHandle]);

  const emailHandle = ftn.activity<SendEmailInput, void>("send-email", {
    to: input.email,
    subject: "Completa tu pago",
    htmlBody: `<p>Escanea este código para completar tu pago del plan <strong>${input.planName}</strong> (${input.priceCents / 100} €):</p><img src="${qrUrl}" />`,
  });

  await ftn.join([emailHandle]);

  const payment = await ftn.signal<PaymentCompletedSignalData>("payment-completed");

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