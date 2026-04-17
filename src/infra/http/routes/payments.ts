import type http from "node:http";
import Stripe from "stripe";
import { readBodyCapped } from "../security";
import type { FtnAppRouteContext } from "../route-context";
import { sendJson } from "../response";
import { buildWorkflowTask } from "../../../shared/task-factories";

export async function tryPaymentsRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _rawPath: string
): Promise<boolean> {
  if (req.method === "POST" && req.url === "/pay/checkout") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const { successUrl, cancelUrl, customerEmail, currency, lineItems, metadata } = parsed;

        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) {
          res.statusCode = 500;
          res.end("STRIPE_SECRET_KEY not configured");
          return;
        }

        const stripe = new Stripe(key, { apiVersion: "2024-06-20" as any });
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          success_url: successUrl,
          cancel_url: cancelUrl,
          customer_email: customerEmail,
          currency,
          line_items: lineItems.map((li: any) => ({
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
        res.statusCode = 500;
        res.end(`Error creating checkout: ${(e as Error).message}`);
      }
    });
    return true;
  }

  if (req.method === "POST" && req.url === "/stripe/webhook") {
    const sig = req.headers["stripe-signature"];
    const body = await readBodyCapped(req, res, ctx.apiSecurity.maxBodyBytes);
    if (body === null) return true;
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      if (!webhookSecret || !stripeSecretKey) {
        res.statusCode = 500;
        res.end("Stripe secrets not configured");
        return true;
      }

      const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" as any });
      const event = stripe.webhooks.constructEvent(body, sig as string, webhookSecret);

      if (event.type === "checkout.session.completed") {
        const session: any = event.data.object;
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
      res.statusCode = 400;
      res.end(`Webhook error: ${(err as Error).message}`);
    }

    return true;
  }

  return false;
}
