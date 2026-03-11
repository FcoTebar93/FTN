import Stripe from "stripe";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { GetPaymentStatusInput, GetPaymentStatusResult } from "./types";
import type { PaymentsConfig } from "./index";

export function getPaymentStatusActivityDefinition(config: PaymentsConfig): ActivityDefinition<GetPaymentStatusInput, GetPaymentStatusResult> {
  const { stripeSecretKey } = config;

  if (!stripeSecretKey) {
    throw new Error("Config inválida para payments.getPaymentStatus: falta stripeSecretKey");
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" as any });

  return {
    name: "payments.getPaymentStatus:v1",
    maxAttempts: 3,
    timeoutMs: 10_000,
    tags: ["payments", "stripe"],
    version: "v1",
    async execute(input: GetPaymentStatusInput, ctx: ActivityExecutionContext): Promise<GetPaymentStatusResult> {
      ctx.log("Consultando estado de sesión de pago", { sessionId: input.sessionId });

      const session = await stripe.checkout.sessions.retrieve(input.sessionId);

      const status = (session.status ?? "open") as GetPaymentStatusResult["status"];

      return {
        status,
        amountTotal: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
        customerEmail: session.customer_details?.email ?? undefined,
      };
    },
  };
}