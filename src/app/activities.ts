import type { SendEmailInput, GenerateQrCodeInput, DbExecuteInput, DbExecuteResult } from "./activity-types";
import * as QRCode from "qrcode";
import Stripe from "stripe";
import type { StripeCreateCheckoutSessionInput, StripeCreateCheckoutSessionResult } from "./activity-types";
import { Pool } from "pg";
import sgMail from "@sendgrid/mail";

let chargeAttempts = 0;
let pool: Pool | null = null;

function getPool(): Pool {
    if (pool) return pool;
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL no está configurada");
    pool = new Pool({ connectionString: cs });
    return pool;
}

export type ActivityFn<TInput = unknown, TResult = unknown> = (input: TInput) => Promise<TResult> | TResult;

export interface ActivityRegistry {
    getActivity(name: string): ActivityFn | undefined;
}

export class InMemoryActivityRegistry implements ActivityRegistry {
    private readonly activities = new Map<string, ActivityFn>();

    register<TInput, TResult>(name: string, activity: ActivityFn<TInput, TResult>): void {
        this.activities.set(name, activity as ActivityFn<unknown, unknown>);
    }

    getActivity(name: string): ActivityFn | undefined {
        return this.activities.get(name);
    }
}

export const validateOrderActivity: ActivityFn<{orderId: string;userId: string;amount: number;}, void> = async (input) => {
    console.log("[activity] validate-order", input);
};

export const chargePaymentActivity: ActivityFn<{orderId: string;amount: number;}, void> = async (input) => {
  chargeAttempts += 1;
  console.log("[activity] charge-payment attempt", chargeAttempts, input);

  if (chargeAttempts < 2) {
    throw new Error("Simulated payment gateway failure");
  }
};

export const createShipmentActivity: ActivityFn<{orderId: string; userId: string;}, void> = async (input) => {
    console.log("[activity] create-shipment", input);
};

export const sendEmailActivity: ActivityFn<SendEmailInput, void> = async (input) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM ?? process.env.SMTP_FROM;
  
  if (!apiKey){
    throw new Error("SENDGRID_API_KEY no está configurada");
  } 
  
  if (!from){
    throw new Error("EMAIL_FROM/SMTP_FROM no está configurado");
  }
  
  sgMail.setApiKey(apiKey);
  
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const msg = {
    from,
    to,
    subject: input.subject ?? "[FTN] Notificación",
    ...(input.textBody ? { text: input.textBody } : {}),
    ...(input.htmlBody ? { html: input.htmlBody } : {}),
  };
  await sgMail.send(msg as any);
};

export const generateQrCodeActivity: ActivityFn<GenerateQrCodeInput, string> = async (input) => {
    const size = input.size ?? 256;
    const format = input.format ?? "png";
  
    if (format === "png") {
      const dataUrl = await QRCode.toDataURL(input.data, { width: size });
      return dataUrl;
    }
  
    if (format === "svg") {
      const svg = await QRCode.toString(input.data, { type: "svg", width: size });
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  
    throw new Error(`Unsupported QR format: ${format}`);
};

export const stripeCreateCheckoutSessionActivity: ActivityFn<StripeCreateCheckoutSessionInput,StripeCreateCheckoutSessionResult> = async (input) => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY no está configurada");

  const stripe = new Stripe(key, { apiVersion: "2024-06-20" as any });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    currency: input.currency,
    line_items: input.lineItems.map((li) => ({
      quantity: li.quantity,
      price_data: {
        currency: input.currency,
        unit_amount: li.unitAmountCents,
        product_data: { name: li.name },
      },
    })),
    metadata: input.metadata,
  });

  if (!session.url) throw new Error("Stripe session sin url");
  return { sessionId: session.id, url: session.url };
};

export const dbExecuteActivity: ActivityFn<DbExecuteInput, DbExecuteResult> = async (input) => {
    const res = await getPool().query(input.sql, input.params ?? []);
    return { rowCount: res.rowCount ?? 0, rows: res.rows ?? [] };
};