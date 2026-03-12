import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { ValidateOrderInput } from "./types";

export function validateOrderActivityDefinition(): ActivityDefinition<ValidateOrderInput, void> {
  return {
    name: "payments.validateOrder:v1",
    maxAttempts: 1,
    tags: ["payments", "order"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["orderId", "userId", "amount"],
      properties: {
        orderId: { type: "string", description: "ID del pedido" },
        userId: { type: "string", description: "ID del usuario" },
        amount: { type: "number", description: "Importe del pedido" },
      },
      additionalProperties: false,
    },
    
    async execute(input: ValidateOrderInput, ctx: ActivityExecutionContext): Promise<void> {
      ctx.log("Validando pedido", { orderId: input.orderId, userId: input.userId, amount: input.amount });
    }
  };
}