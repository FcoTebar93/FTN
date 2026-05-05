import type http from "node:http";
import Stripe from "stripe";
import { readBodyCapped } from "../security";
import type { FtnAppRouteContext } from "../route-context";
import { sendError, sendJson } from "../response";
import { buildWorkflowTask } from "../../../shared/task-factories";
import { readJsonBodyCapped } from "../request";

interface CheckoutLineItemInput {
  quantity: number;
  unitAmountCents: number;
  name: string;
}

interface CheckoutRequestBody {
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  currency: string;
  lineItems: CheckoutLineItemInput[];
  metadata?: Record<string, string>;
}

export async function tryPaymentsRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _rawPath: string
): Promise<boolean> {
  if (req.method === "POST" && req.url === "/pay/checkout") {
    const parsedResult = await readJsonBodyCapped<CheckoutRequestBody>(req, res, ctx.apiSecurity.maxBodyBytes);
    if (!parsedResult.ok) return true;
    try {
      const { successUrl, cancelUrl, customerEmail, currency, lineItems, metadata } = parsedResult.value;
      const key = ctx.stripeSecretKey;
      if (!key) {
        sendError(res, 500, "STRIPE_SECRET_KEY not configured");
        return true;
      }
      const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: customerEmail,
        currency,
        line_items: lineItems.map((li) => ({
          quantity: li.quantity,
          price_data: {
            currency,
            unit_amount: li.unitAmountCents,
            product_data: { name: li.name },
          },
        })),
        metadata,
      });
      sendJson(res, 200, { sessionId: session.id, url: session.url });
    } catch (e) {
      sendError(res, 500, `Error creating checkout: ${(e as Error).message}`);
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/stripe/webhook") {
    const sig = req.headers["stripe-signature"];
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const webhookSecret = ctx.stripeWebhookSecret;
      const stripeSecretKey = ctx.stripeSecretKey;
      if (!webhookSecret || !stripeSecretKey) {
        sendError(res, 500, "Stripe secrets not configured");
        return true;
      }

      const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });
      const event = stripe.webhooks.constructEvent(body, sig as string, webhookSecret);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const md = session.metadata || {};
        const workflowId = md.workflowId;
        const runId = md.runId;

        if (workflowId && runId) {
          const state = await ctx.runtime.loadCurrentState(workflowId, runId);
          if (state) {
            await ctx.eventStore.appendEvents(workflowId, runId, state.version, [
              {
                type: "SignalReceived",
                workflowId,
                runId,
                payload: {
                  signalName: "payment-completed",
                  data: {
                    sessionId: session.id,
                    amountTotal: session.amount_total,
                    currency: session.currency,
                    customerEmail: session.customer_details?.email,
                  },
                },
              },
            ]);
            const task = buildWorkflowTask({
              id: `wf-task-signal-${workflowId}-${runId}-${Date.now()}`,
              workflowId,
              runId,
              targetQueue: "workflows",
              correlationId: ctx.correlationId,
            });
            await ctx.taskQueue.enqueue(task);
          }
        }
      }
      res.statusCode = 200;
      res.end("[OK] webhook processed");
    } catch (err) {
      sendError(res, 400, `Webhook error: ${(err as Error).message}`);
    }

    return true;
  }

  return false;
}
