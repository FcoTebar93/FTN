import type { WorkflowDefinition } from "../core/ftn";
import type { GenerateQrCodeInput } from "../modules/integrations/documents/types";
import type { SendEmailInput } from "../modules/integrations/notifications/types";
import type { DbExecuteInput, DbExecuteResult } from "../modules/integrations/storage/types";
import type { PaymentCompletedSignalData } from "../modules/integrations/payments/types";

type WorkflowMap = Map<string, WorkflowDefinition<any, any>>;

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "http://localhost:5173";
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

export const orderProcessingWorkflow: WorkflowDefinition<OrderInput, OrderResult> = async (ftn, input) => {
  const validateHandle = ftn.activity<OrderInput, void>("validate-order", input);
  const shipmentHandle = ftn.activity<OrderInput, void>("create-shipment", input);

  await ftn.retry(
    { maxAttempts: 3, backOffMs: 500 },
    async () => {
      await ftn.activity<{ orderId: string; amount: number }, void>(
        "payments.chargePayment:v1",
        { orderId: input.orderId, amount: input.amount }
      );
    }
  );
  
  const validatePromise = ftn.activity<{ orderId: string; userId: string; amount: number }, void>(
    "payments.validateOrder:v1",
    { orderId: input.orderId, userId: input.userId, amount: input.amount }
  );
  
  const shipmentPromise = ftn.activity<{ orderId: string; userId: string }, void>(
    "logistics.createShipment:v1",
    { orderId: input.orderId, userId: input.userId }
  );
  
  await Promise.all([validatePromise, shipmentPromise]);
  return { orderId: input.orderId, charged: true, shipped: true };
};

export const paymentSignupWorkflow: WorkflowDefinition<PaymentSignupInput, PaymentSignupResult> =
  async (ftn, input) => {
    const wfId = ftn.workflowId();
    const runId = ftn.runId();

    const url = new URL("/pagar", FRONTEND_BASE_URL);
    url.searchParams.set("workflowId", wfId);
    url.searchParams.set("runId", runId);
    url.searchParams.set("email", input.email);
    url.searchParams.set("planName", input.planName);
    url.searchParams.set("priceCents", String(input.priceCents));

    const qrPromise = ftn.activity<GenerateQrCodeInput, string>("documents.generateQrCode:v1", {
      data: url.toString(),
      size: 256,
      format: "png",
    });

    const [qrUrl] = await qrPromise;

    const emailHandle = ftn.activity<SendEmailInput, void>("notifications.sendEmail:v1", {
      to: input.email,
      subject: "Completa tu pago",
      htmlBody: `<p>Escanea este código para completar tu pago del plan <strong>${input.planName}</strong> (${input.priceCents / 100} €):</p><img src="${qrUrl}" />`,
    });

    const payment = await ftn.signal<PaymentCompletedSignalData>("payment-completed");

    await ftn.activity<SendEmailInput, void>("notifications.sendEmail:v1", {
      to: input.email,
      subject: "Completa tu pago",
      htmlBody: `<p>Escanea este código para completar tu pago del plan <strong>${input.planName}</strong> (${input.priceCents / 100} €):</p><img src="${qrUrl}" />`,
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