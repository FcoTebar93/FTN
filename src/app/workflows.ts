import type { WorkflowDefinition } from "../core/ftn";
import type { GenerateQrCodeInput } from "../modules/integrations/documents/types";
import type { SendEmailInput } from "../modules/integrations/notifications/types";
import type { DbExecuteInput, DbExecuteResult } from "../modules/integrations/storage/types";
import type { PaymentCompletedSignalData } from "../modules/integrations/payments/types";
import type { JsonSchema } from "../shared/json-schema";

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? "http://localhost:5173";

type WorkflowCatalog = Map<string, WorkflowDescriptor<any, any>>;
type VersionedWorkflowCatalog = Map<string, WorkflowCatalog>;
const workflowCatalog: VersionedWorkflowCatalog = new Map();

function getVersionBucket(name: string): WorkflowCatalog | undefined {
  return workflowCatalog.get(name);
}

function getLatestDescriptor(name: string): WorkflowDescriptor<any, any> | undefined {
  const bucket = getVersionBucket(name);
  if (!bucket || bucket.size === 0) return undefined;
  return Array.from(bucket.values()).sort((a, b) => b.version.localeCompare(a.version))[0];
}

export function getWorkflowDescriptor(
  name: string,
  version?: string
): Omit<WorkflowDescriptor, "definition"> | undefined {
  const d = version ? getVersionBucket(name)?.get(version) : getLatestDescriptor(name);
  if (!d) return undefined;
  const { definition: _definition, ...meta } = d;
  return meta;
}

export function registerWorkflow<TInput, TResult>(descriptor: WorkflowDescriptor<TInput, TResult>): void {
  const bucket = workflowCatalog.get(descriptor.name) ?? new Map<string, WorkflowDescriptor<any, any>>();
  bucket.set(descriptor.version, descriptor as WorkflowDescriptor<any, any>);
  workflowCatalog.set(descriptor.name, bucket);
}

export function listWorkflows(): Array<Omit<WorkflowDescriptor, "definition">> {
  return Array.from(workflowCatalog.values())
    .flatMap((bucket) => Array.from(bucket.values()))
    .map(({ definition: _definition, ...meta }) => meta)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function listWorkflowVersions(name: string): Array<Omit<WorkflowDescriptor, "definition">> {
  const bucket = getVersionBucket(name);
  if (!bucket) return [];
  return Array.from(bucket.values())
    .map(({ definition: _definition, ...meta }) => meta)
    .sort((a, b) => a.version.localeCompare(b.version));
}

export function getWorkflow(name: string, version?: string): WorkflowDefinition<any, any> | undefined {
  if (version) {
    return getVersionBucket(name)?.get(version)?.definition;
  }

  return getLatestDescriptor(name)?.definition;
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

export interface ApprovalFlowInput {
  requestId: string;
  requesterEmail: string;
  approverEmail: string;
  subject: string;
  amount: number;
}

export interface ApprovalFlowResult {
  requestId: string;
  approved: boolean;
  reviewer?: string;
  comment?: string;
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

export const approvalFlowWorkflow: WorkflowDefinition<ApprovalFlowInput, ApprovalFlowResult> = async (ftn, input) => {
  const requestUrl = new URL("/workflows", FRONTEND_BASE_URL);
  requestUrl.searchParams.set("requestId", input.requestId);

  const requestEmail = ftn.activity<SendEmailInput, void>("notifications.sendEmail:v1", {
    to: input.approverEmail,
    subject: `[Aprobación requerida] ${input.subject}`,
    htmlBody: `
      <p>Se requiere tu aprobación para la solicitud <strong>${input.requestId}</strong>.</p>
      <p>Importe: <strong>${input.amount}</strong></p>
      <p>Referencia: <a href="${requestUrl.toString()}">${requestUrl.toString()}</a></p>
      <p>Envía la señal <code>approval-decision</code> con { approved, reviewer, comment }.</p>
    `,
  });
  await ftn.join([requestEmail]);

  const decision = await ftn.signal<{ approved: boolean; reviewer?: string; comment?: string }>("approval-decision");

  const auditHandle = ftn.activity<DbExecuteInput, DbExecuteResult>("storage.dbExecute:v1", {
    sql: `
      insert into approvals(request_id, approved, reviewer, comment, requester_email, approver_email, amount, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, now())
    `,
    params: [
      input.requestId,
      decision.approved,
      decision.reviewer ?? null,
      decision.comment ?? null,
      input.requesterEmail,
      input.approverEmail,
      input.amount,
    ],
  });

  const notifyRequester = ftn.activity<SendEmailInput, void>("notifications.sendEmail:v1", {
    to: input.requesterEmail,
    subject: decision.approved
      ? `[Aprobada] ${input.subject}`
      : `[Rechazada] ${input.subject}`,
    htmlBody: decision.approved
      ? `<p>Tu solicitud <strong>${input.requestId}</strong> ha sido aprobada.</p>`
      : `<p>Tu solicitud <strong>${input.requestId}</strong> ha sido rechazada. Comentario: ${decision.comment ?? "sin comentario"}.</p>`,
  });

  await ftn.join([auditHandle, notifyRequester]);

  return {
    requestId: input.requestId,
    approved: decision.approved,
    reviewer: decision.reviewer,
    comment: decision.comment,
  };
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

registerWorkflow<OrderInput, OrderResult>({
  name: "order-processing",
  version: "v1",
  displayName: "Procesamiento de pedido",
  description:
    "Cobra el pedido (con reintentos), valida el importe y crea el envío en paralelo. Pensado para demos con activities de pagos y logística.",
  tags: ["ecommerce", "payments", "logistics"],
  examples: [
    {
      input: { orderId: "ord-demo-1", userId: "user-42", amount: 49.99 },
      note: "Requiere integraciones de payments y logistics habilitadas.",
    },
  ],
  inputSchema: {
    type: "object",
    required: ["orderId", "userId", "amount"],
    properties: {
      orderId: { type: "string", description: "Identificador del pedido" },
      userId: { type: "string", description: "Identificador del usuario" },
      amount: { type: "number", minimum: 0, description: "Importe a cobrar (misma unidad que la activity de cobro)" },
    },
    additionalProperties: false,
  },
  resultSchema: {
    type: "object",
    required: ["orderId", "charged", "shipped"],
    properties: {
      orderId: { type: "string" },
      charged: { type: "boolean" },
      shipped: { type: "boolean" },
    },
    additionalProperties: false,
  },
  definition: orderProcessingWorkflow,
});

registerWorkflow<ApprovalFlowInput, ApprovalFlowResult>({
  name: "approval-flow",
  version: "v1",
  displayName: "Approval Flow",
  description:
    "Solicita aprobación por email, espera señal de decisión y persiste auditoría del resultado.",
  tags: ["approvals", "backoffice", "notifications"],
  examples: [
    {
      input: {
        requestId: "apr-2026-0001",
        requesterEmail: "requester@acme.com",
        approverEmail: "manager@acme.com",
        subject: "Compra extraordinaria",
        amount: 1250,
      },
      note: "Enviar señal approval-decision para completar el run.",
    },
  ],
  inputSchema: {
    type: "object",
    required: ["requestId", "requesterEmail", "approverEmail", "subject", "amount"],
    properties: {
      requestId: { type: "string" },
      requesterEmail: { type: "string", format: "email" },
      approverEmail: { type: "string", format: "email" },
      subject: { type: "string" },
      amount: { type: "number", minimum: 0 },
    },
    additionalProperties: false,
  },
  resultSchema: {
    type: "object",
    required: ["requestId", "approved"],
    properties: {
      requestId: { type: "string" },
      approved: { type: "boolean" },
      reviewer: { type: "string" },
      comment: { type: "string" },
    },
    additionalProperties: false,
  },
  definition: approvalFlowWorkflow,
});