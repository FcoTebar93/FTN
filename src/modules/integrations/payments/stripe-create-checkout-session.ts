import Stripe from "stripe";
import type { StripeCreateCheckoutSessionInput, StripeCreateCheckoutSessionResult } from "./types";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { PaymentsConfig } from ".";

export function stripeCreateCheckoutSessionActivityDefinition(config: PaymentsConfig): ActivityDefinition<StripeCreateCheckoutSessionInput, StripeCreateCheckoutSessionResult> {
    const { stripeSecretKey } = config;

    if (!stripeSecretKey) {
        throw new Error("Stripe secret key is not configured");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });

    return {
        name: "payments.stripeCreateCheckoutSession:v1",
        maxAttempts: 3,
        timeoutMs: 30_000,
        tags: ["payments", "stripe"],
        version: "1.0.0",
        inputSchema: {
            type: "object",
            required: ["successUrl", "cancelUrl", "currency", "lineItems"],
            properties: {
              successUrl: { type: "string", description: "URL de éxito para Stripe Checkout" },
              cancelUrl: { type: "string", description: "URL de cancelación" },
              customerEmail: { type: "string", description: "Email del cliente (opcional)" },
              currency: { type: "string", description: "Moneda ISO 3, ej. 'eur'" },
              lineItems: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "unitAmountCents", "quantity"],
                  properties: {
                    name: { type: "string" },
                    unitAmountCents: { type: "integer", description: "Importe en céntimos" },
                    quantity: { type: "integer", minimum: 1 },
                  },
                },
              },
              metadata: {
                type: "object",
                description: "Metadatos que se adjuntan a la sesión",
                additionalProperties: true,
              },
            },
            additionalProperties: false,
        },

        execute: async (input: StripeCreateCheckoutSessionInput, ctx: ActivityExecutionContext) => {
            ctx.log("Creando Stripe Checkout Session", {customerEmail: input.customerEmail, currency: input.currency});
            
            try {
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

                if (!session.url) {
                    throw new Error("Stripe Checkout Session sin url");
                }

                return {
                    sessionId: session.id,
                    url: session.url,
                };
            } catch (error: unknown) {
               ctx.log("Error creando Stripe Checkout Session", { error: error });
                throw error;
            }
        }
    };
}