import type { DesignerStoredWorkflow } from "../../api/types";

export interface DesignerTemplate {
  id: string;
  label: string;
  description: string;
  requiredActivities: string[];
  build: () => DesignerStoredWorkflow;
}

export const WORKFLOW_TEMPLATES: DesignerTemplate[] = [
  {
    id: "kyc-daily-email",
    label: "KYC diario + email",
    description: "Verificación de identidad y envío de email diario a una hora fija.",
    requiredActivities: ["identity.verifyIdentity:v1", "notifications.sendEmail:v1"],
    build: () => ({
      id: "kyc-daily-email",
      version: "v1",
      displayName: "KYC diario + email",
      description: "Verifica identidad del usuario y envía un email con el resultado todos los días.",
      tags: ["identity", "email", "daily"],
      schedule: { type: "daily", hour: 9, minute: 0, timezone: "Europe/Madrid" },
      scheduledInput: {
        userId: "user-123",
        documentType: "DNI",
        documentImageUrl: "https://example.com/dni.png",
        email: "user@example.com",
      },
      inputSchema: {
        type: "object",
        required: ["userId", "documentType", "documentImageUrl", "email"],
        properties: {
          userId: { type: "string", description: "ID del usuario" },
          documentType: { type: "string", description: "Tipo de documento (DNI, pasaporte...)" },
          documentImageUrl: { type: "string", description: "URL del documento" },
          email: { type: "string", format: "email", description: "Email del usuario" },
        },
        additionalProperties: false,
      },
      resultSchema: undefined,
      steps: [
        {
          id: "step-verify",
          kind: "activity",
          name: "Verificar identidad",
          activityName: "identity.verifyIdentity:v1",
          input: {
            userId: "{{ input.userId }}",
            documentType: "{{ input.documentType }}",
            documentImageUrl: "{{ input.documentImageUrl }}",
          },
          next: "step-email",
        } as any,
        {
          id: "step-email",
          kind: "activity",
          name: "Enviar email resultado",
          activityName: "notifications.sendEmail:v1",
          input: {
            to: "{{ input.email }}",
            subject: "Resultado verificación identidad",
            htmlBody:
              "<p>Resultado KYC: <strong>{{ steps.step-verify.success }}</strong> (score {{ steps.step-verify.score }})</p>",
          },
          next: null,
        } as any,
      ],
      entryStepId: "step-verify",
    }),
  },
  {
    id: "signup-payment-crm",
    label: "Alta con pago + CRM",
    description: "Checkout de pago, notificación email y alta/actualización en CRM.",
    requiredActivities: [
      "payments.stripeCreateCheckoutSession:v1",
      "payments.getPaymentStatus:v1",
      "notifications.sendEmail:v1",
      "crm.upsertUser:v1",
    ],
    build: () => ({
      id: "signup-payment-crm",
      version: "v1",
      displayName: "Alta con pago + CRM",
      description: "Crea sesión de checkout, consulta estado y registra el usuario en CRM.",
      tags: ["payments", "notifications", "crm", "signup"],
      schedule: { type: "instant" },
      scheduledInput: {
        email: "user@example.com",
        planName: "Pro",
        priceCents: 9900,
      },
      inputSchema: {
        type: "object",
        required: ["email", "planName", "priceCents"],
        properties: {
          email: { type: "string", format: "email", description: "Email del usuario" },
          planName: { type: "string", description: "Plan a contratar" },
          priceCents: { type: "integer", minimum: 0, description: "Importe en céntimos" },
        },
        additionalProperties: false,
      },
      resultSchema: undefined,
      steps: [
        {
          id: "step-checkout",
          kind: "activity",
          name: "Crear sesión de checkout",
          activityName: "payments.stripeCreateCheckoutSession:v1",
          input: {
            successUrl: "https://example.com/pago-exito",
            cancelUrl: "https://example.com/pago-cancelado",
            currency: "eur",
            lineItems: [
              {
                name: "{{ input.planName }}",
                quantity: 1,
                unitAmountCents: "{{ input.priceCents }}",
              },
            ],
            customerEmail: "{{ input.email }}",
            metadata: {
              source: "designer-template-signup",
            },
          },
          next: "step-status",
        } as any,
        {
          id: "step-status",
          kind: "activity",
          name: "Consultar estado del pago",
          activityName: "payments.getPaymentStatus:v1",
          input: {
            sessionId: "{{ steps.step-checkout.sessionId }}",
          },
          next: "step-email",
        } as any,
        {
          id: "step-email",
          kind: "activity",
          name: "Enviar email de confirmación",
          activityName: "notifications.sendEmail:v1",
          input: {
            to: "{{ input.email }}",
            subject: "Confirmación de alta",
            htmlBody:
              "<p>Tu alta al plan <strong>{{ input.planName }}</strong> está en curso.</p><p>Estado de pago: {{ steps.step-status.status }}</p>",
          },
          next: "step-crm",
        } as any,
        {
          id: "step-crm",
          kind: "activity",
          name: "Alta/actualización en CRM",
          activityName: "crm.upsertUser:v1",
          input: {
            email: "{{ input.email }}",
            planName: "{{ input.planName }}",
            metadata: {
              paymentStatus: "{{ steps.step-status.status }}",
              checkoutSessionId: "{{ steps.step-checkout.sessionId }}",
            },
          },
          next: null,
        } as any,
      ],
      entryStepId: "step-checkout",
    }),
  },
  {
    id: "order-processing-instant",
    label: "Procesar pedido (instantáneo)",
    description: "Valida, cobra y crea envío al guardar el workflow.",
    requiredActivities: [
      "payments.validateOrder:v1",
      "payments.chargePayment:v1",
      "logistics.createShipment:v1",
    ],
    build: () => ({
      id: "order-processing-instant",
      version: "v1",
      displayName: "Procesar pedido (instantáneo)",
      description: "Workflow de ecommerce básico: validación, cobro y envío.",
      tags: ["payments", "logistics", "instant"],
      schedule: { type: "instant" },
      scheduledInput: {
        orderId: "ord-1001",
        userId: "user-42",
        amount: 49.99,
      },
      inputSchema: {
        type: "object",
        required: ["orderId", "userId", "amount"],
        properties: {
          orderId: { type: "string", description: "Id del pedido" },
          userId: { type: "string", description: "Id del usuario" },
          amount: { type: "number", description: "Importe a cobrar" },
        },
        additionalProperties: false,
      },
      resultSchema: undefined,
      steps: [
        {
          id: "step-validate",
          kind: "activity",
          name: "Validar pedido",
          activityName: "payments.validateOrder:v1",
          input: {
            orderId: "{{ input.orderId }}",
            userId: "{{ input.userId }}",
            amount: "{{ input.amount }}",
          },
          next: "step-charge",
        } as any,
        {
          id: "step-charge",
          kind: "activity",
          name: "Cobrar pedido",
          activityName: "payments.chargePayment:v1",
          input: {
            orderId: "{{ input.orderId }}",
            amount: "{{ input.amount }}",
          },
          next: "step-shipment",
        } as any,
        {
          id: "step-shipment",
          kind: "activity",
          name: "Crear envío",
          activityName: "logistics.createShipment:v1",
          input: {
            orderId: "{{ input.orderId }}",
            userId: "{{ input.userId }}",
          },
          next: null,
        } as any,
      ],
      entryStepId: "step-validate",
    }),
  },
  {
    id: "sms-weekly-reminder",
    label: "Recordatorio SMS semanal",
    description: "Envía SMS de recordatorio en días y hora seleccionados.",
    requiredActivities: ["notifications.sendSms:v1"],
    build: () => ({
      id: "sms-weekly-reminder",
      version: "v1",
      displayName: "Recordatorio SMS semanal",
      description: "Workflow semanal de notificaciones por SMS.",
      tags: ["notifications", "sms", "weekly"],
      schedule: {
        type: "weekly",
        weekdays: [1, 3, 5],
        hour: 9,
        minute: 30,
        timezone: "Europe/Madrid",
      },
      scheduledInput: {
        to: "+34111111111",
        text: "Recordatorio: revisa tu panel FTN hoy.",
      },
      inputSchema: {
        type: "object",
        required: ["to", "text"],
        properties: {
          to: { type: "string", description: "Teléfono destino (formato internacional)" },
          text: { type: "string", description: "Texto del recordatorio" },
        },
        additionalProperties: false,
      },
      resultSchema: undefined,
      steps: [
        {
          id: "step-sms",
          kind: "activity",
          name: "Enviar SMS",
          activityName: "notifications.sendSms:v1",
          input: {
            to: "{{ input.to }}",
            text: "{{ input.text }}",
          },
          next: null,
        } as any,
      ],
      entryStepId: "step-sms",
    }),
  },
  {
    id: "webhook-weekly-crm",
    label: "Webhook semanal → CRM",
    description: "Consulta HTTP y upsert en CRM de lunes a viernes.",
    requiredActivities: ["http.request:v1", "crm.upsertUser:v1"],
    build: () => ({
      id: "webhook-weekly-crm",
      version: "v1",
      displayName: "Webhook semanal → CRM",
      description: "Pide datos a un webhook y actualiza el CRM todos los días laborales.",
      tags: ["http", "crm", "weekly"],
      schedule: {
        type: "weekly",
        weekdays: [1, 2, 3, 4, 5],
        hour: 10,
        minute: 0,
        timezone: "Europe/Madrid",
      },
      scheduledInput: {
        webhookUrl: "https://api.example.com/users/today",
        channel: "newsletter",
      },
      inputSchema: {
        type: "object",
        required: ["webhookUrl"],
        properties: {
          webhookUrl: { type: "string", description: "URL del endpoint que devuelve usuarios" },
          channel: { type: "string", description: "Canal o segmento CRM", default: "newsletter" as any },
        },
        additionalProperties: false,
      },
      resultSchema: undefined,
      steps: [
        {
          id: "step-http",
          kind: "activity",
          name: "Cargar usuarios",
          activityName: "http.request:v1",
          input: {
            url: "{{ input.webhookUrl }}",
            method: "GET",
          },
          next: "step-crm",
        } as any,
        {
          id: "step-crm",
          kind: "activity",
          name: "Upsert usuario en CRM",
          activityName: "crm.upsertUser:v1",
          input: {
            email: "{{ steps.step-http.bodyJson.email }}",
            name: "{{ steps.step-http.bodyJson.name }}",
            planName: "{{ steps.step-http.bodyJson.planName }}",
            metadata: {
              channel: "{{ input.channel }}",
            },
          },
          next: null,
        } as any,
      ],
      entryStepId: "step-http",
    }),
  },
  {
    id: "signup-payment-hybrid-qr",
    label: "Alta + pago híbrido (QR + /pagar)",
    description:
      "Inserta usuario, genera QR y email con enlace /pagar usando {{ run.workflowId }} y {{ run.runId }}; espera señal payment-completed y actualiza stripe_session_id.",
    requiredActivities: ["storage.dbExecute:v1", "documents.generateQrCode:v1", "notifications.sendEmail:v1"],
    build: () => ({
      id: "signup-payment-hybrid-qr",
      version: "v1",
      displayName: "Alta + pago híbrido (Designer)",
      description: "Flujo demo alineado con paymentSignupWorkflow: DB + QR + email + señal + update.",
      tags: ["payments", "designer", "hybrid", "signup"],
      schedule: { type: "instant" },
      scheduledInput: {
        email: "user@example.com",
        planName: "Pro",
        priceCents: 9900,
      },
      inputSchema: {
        type: "object",
        required: ["email", "planName", "priceCents"],
        properties: {
          email: { type: "string", format: "email", description: "Email del usuario" },
          planName: { type: "string", description: "Plan a contratar" },
          priceCents: { type: "integer", minimum: 0, description: "Importe en céntimos" },
        },
        additionalProperties: false,
      },
      resultSchema: undefined,
      steps: [
        {
          id: "insert-user",
          kind: "activity",
          name: "Registrar usuario (users)",
          activityName: "storage.dbExecute:v1",
          input: {
            sql: "insert into users(email, stripe_session_id, created_at) values ($1, null, now()) on conflict (email) do nothing",
            params: ["{{ input.email }}"],
          },
          next: "qr-pay",
        } as any,
        {
          id: "qr-pay",
          kind: "activity",
          name: "QR con URL /pagar del run",
          activityName: "documents.generateQrCode:v1",
          input: {
            data: "http://localhost:5173/pagar?workflowId={{ run.workflowId }}&runId={{ run.runId }}&email={{ input.email }}&planName={{ input.planName }}&priceCents={{ input.priceCents }}",
            size: 256,
            format: "png",
          },
          next: "email-pay",
        } as any,
        {
          id: "email-pay",
          kind: "activity",
          name: "Email con QR y enlace",
          activityName: "notifications.sendEmail:v1",
          input: {
            to: "{{ input.email }}",
            subject: "Completa tu pago",
            htmlBody:
              "<p>Plan <strong>{{ input.planName }}</strong> ({{ input.priceCents }} céntimos).</p><p><img src=\"{{ steps.qr-pay }}\" alt=\"QR pago\" width=\"256\" height=\"256\"/></p><p><a href=\"http://localhost:5173/pagar?workflowId={{ run.workflowId }}&runId={{ run.runId }}&email={{ input.email }}&planName={{ input.planName }}&priceCents={{ input.priceCents }}\">Abrir pasarela de pago</a></p>",
          },
          next: "wait-payment",
        } as any,
        {
          id: "wait-payment",
          kind: "signal",
          name: "Esperar pago completado",
          signalName: "payment-completed",
          next: "update-user",
        } as any,
        {
          id: "update-user",
          kind: "activity",
          name: "Guardar sessionId Stripe",
          activityName: "storage.dbExecute:v1",
          input: {
            sql: "update users set stripe_session_id = $2 where email = $1",
            params: ["{{ input.email }}", "{{ steps.wait-payment.sessionId }}"],
          },
          next: null,
        } as any,
      ],
      entryStepId: "insert-user",
    }),
  },
];