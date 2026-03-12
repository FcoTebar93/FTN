import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { CheckFraudScoreInput, CheckFraudScoreResult } from "./types";


export function checkFraudScoreActivityDefinition(): ActivityDefinition<CheckFraudScoreInput, CheckFraudScoreResult> {
  return {
    name: "identity.checkFraudScore:v1",
    maxAttempts: 1,
    timeoutMs: 5_000,
    tags: ["identity", "fraud", "risk"],
    version: "v1",
    inputSchema: {
    type: "object",
    required: ["userId", "orderId", "amountCents", "currency"],
    properties: {
      userId: { type: "string" },
      orderId: { type: "string" },
      amountCents: { type: "integer", description: "Importe en céntimos" },
      currency: { type: "string" },
      ipAddress: { type: "string", description: "IP del cliente (opcional)" },
      deviceId: { type: "string", description: "ID de dispositivo (opcional)" },
    },
    additionalProperties: false,
    },
    
    async execute(input: CheckFraudScoreInput, ctx: ActivityExecutionContext): Promise<CheckFraudScoreResult> {
      ctx.log("Calculando fraude", {
        userId: input.userId,
        orderId: input.orderId,
        amountCents: input.amountCents,
        currency: input.currency,
        ipAddress: input.ipAddress,
        deviceId: input.deviceId,
      });

      const baseScore = Math.min(input.amountCents / 100_00, 1);
      let riskLevel: CheckFraudScoreResult["riskLevel"];

      if (baseScore < 0.3) {
        riskLevel = "low";
      } else if (baseScore < 0.7) {
        riskLevel = "medium";
      } else {
        riskLevel = "high";
      }

      return {
        score: baseScore,
        riskLevel,
      };
    },
  };
}