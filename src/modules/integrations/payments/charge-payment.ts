import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { ChargePaymentInput } from "./types";

let chargeAttempts = 0;

export function chargePaymentActivityDefinition(): ActivityDefinition<ChargePaymentInput, void> {
  return {
    name: "payments.chargePayment:v1",
    maxAttempts: 3,
    tags: ["payments"],
    version: "v1",
    async execute(input: ChargePaymentInput, ctx: ActivityExecutionContext): Promise<void> {
      chargeAttempts += 1;
      ctx.log("Cobro de pago", { attempt: chargeAttempts, orderId: input.orderId, amount: input.amount });

      if (chargeAttempts < 2) {
        throw new Error("Simulated payment gateway failure");
      }
    }
  };
}