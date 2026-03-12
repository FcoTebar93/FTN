import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { CreateShipmentInput } from "./types";

export function createShipmentActivityDefinition(): ActivityDefinition<CreateShipmentInput, void> {
  return {
    name: "logistics.createShipment:v1",
    maxAttempts: 1,
    tags: ["logistics", "shipping"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["orderId", "userId"],
      properties: {
        orderId: { type: "string", description: "ID del pedido a enviar" },
        userId: { type: "string", description: "ID del usuario destinatario" },
      },
      additionalProperties: false,
    },
    
    async execute(input: CreateShipmentInput, ctx: ActivityExecutionContext): Promise<void> {
      ctx.log("Creando envío", { orderId: input.orderId, userId: input.userId });
    }
  };
}