import type { WorkflowDefinition } from "../core/ftn";
import type { GenerateQrCodeInput } from "../modules/integrations/documents/types";
import type { SendEmailInput } from "../modules/integrations/notifications/types";
import type { DbExecuteInput, DbExecuteResult } from "../modules/integrations/storage/types";
import type { PaymentCompletedSignalData } from "../modules/integrations/payments/types";
import type { JsonSchema } from "../shared/json-schema";

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "http://localhost:5173";

type WorkflowCatalog = Map<string, WorkflowDescriptor<any, any>>;
const workflowCatalog: WorkflowCatalog = new Map();

export function getWorkflowDescriptor(name: string): Omit<WorkflowDescriptor, "definition"> | undefined {
  const d = workflowCatalog.get(name);
  if (!d) return undefined;
  const { definition, ...meta } = d;
  return meta;
}

export function registerWorkflow<TInput, TResult>(descriptor: WorkflowDescriptor<TInput, TResult>): void {
  workflowCatalog.set(descriptor.name, descriptor as WorkflowDescriptor<any, any>);
}

export function listWorkflows(): Array<Omit<WorkflowDescriptor, "definition">> {
  return Array.from(workflowCatalog.values())
    .map(({ definition, ...meta }) => meta)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getWorkflow(name: string): WorkflowDefinition<any, any> | undefined {
  return workflowCatalog.get(name)?.definition;
}

export interface CatalogWorkflow {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  tags: string[];
  inputSchema?: JsonSchema;
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
  await ftn.retry(
    { maxAttempts: 3, backOffMs: 500 },
    async (attempt) => {
      const chargeHandle = ftn.activity<{ orderId: string; amount: number }, void>(
        "payments.chargePayment:v1",
        { orderId: input.orderId, amount: input.amount },
        attempt
      );
      await ftn.join([chargeHandle]);
    }
  );

  const validateHandle = ftn.activity<{ orderId: string; userId: string; amount: number }, void>(
    "payments.validateOrder:v1",
    { orderId: input.orderId, userId: input.userId, amount: input.amount }
  );

  const shipmentHandle = ftn.activity<{ orderId: string; userId: string }, void>(
    "logistics.createShipment:v1",
    { orderId: input.orderId, userId: input.userId }
  );

  await ftn.join([validateHandle, shipmentHandle]);
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

  const qrHandle = ftn.activity<GenerateQrCodeInput, string>("documents.generateQrCode:v1", {
      data: url.toString(),
      size: 256,
      format: "png",
    });

  const [qrUrl] = await ftn.join([qrHandle]);

  const emailHandle = ftn.activity<SendEmailInput, void>("notifications.sendEmail:v1", {
    to: input.email,
    subject: "Completa tu pago",
    htmlBody: `<p>Escanea este código para completar tu pago del plan <strong>${input.planName}</strong> (${input.priceCents / 100} €):</p><img src="${qrUrl}" />`,
  });

    const payment = await ftn.signal<PaymentCompletedSignalData>("payment-completed");

  const dbHandle = ftn.activity<DbExecuteInput, DbExecuteResult>("storage.dbExecute:v1", {
      sql: "insert into users(email, stripe_session_id, created_at) values ($1, $2, now())",
      params: [input.email, payment.sessionId],
    });

  await ftn.join([emailHandle, dbHandle]);

    return { email: input.email, sessionId: payment.sessionId };
};

export interface WorkflowDescriptor<TInput = unknown, TResult = unknown> {
  name: string;
  version: string;
  displayName: string;
  description?: string;
  tags?: string[];
  examples?: Array<{ input: TInput; note?: string }>;

  inputSchema?: JsonSchema;
  resultSchema?: JsonSchema;

  definition: WorkflowDefinition<TInput, TResult>;
}

registerWorkflow<PaymentSignupInput, PaymentSignupResult>({
  name: "payment-signup",
  version: "v1",
  displayName: "Alta con pago",
  description: "Genera QR de pago, envía email y espera señal de pago completado.",
  tags: ["growth", "payments", "notifications"],
  examples: [
    { input: { email: "user@acme.com", planName: "Pro", priceCents: 9900 } },
  ],
  inputSchema: {
    type: "object",
    required: ["email", "planName", "priceCents"],
    properties: {
      email: { type: "string", format: "email" },
      planName: { type: "string" },
      priceCents: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  resultSchema: {
    type: "object",
    required: ["email", "sessionId"],
    properties: {
      email: { type: "string", format: "email" },
      sessionId: { type: "string" },
    },
    additionalProperties: false,
  },
  definition: paymentSignupWorkflow,
});