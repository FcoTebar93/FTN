import Stripe from "stripe";
import type { StripeCreateCheckoutSessionInput, StripeCreateCheckoutSessionResult } from "./types";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { PaymentsConfig } from ".";

export function stripeCreateCheckoutSessionActivityDefinition(config: PaymentsConfig): ActivityDefinition<StripeCreateCheckoutSessionInput, StripeCreateCheckoutSessionResult> {
    const { stripeSecretKey } = config;

    if (!stripeSecretKey) {
        throw new Error("Stripe secret key is not configured");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" as any });

    return {
        name: "stripe-create-checkout-session",
        maxAttempts: 3,
        timeoutMs: 30_000,
        tags: ["payments", "stripe"],
        version: "1.0.0",
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