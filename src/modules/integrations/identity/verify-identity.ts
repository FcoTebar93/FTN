import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import { executeHttpRequest } from "../http/client";
import { integrationsConfigForActivity } from "../runtime";
import type { VerifyIdentityInput, VerifyIdentityResult } from "./types";

export function verifyIdentityActivityDefinition(): ActivityDefinition<VerifyIdentityInput, VerifyIdentityResult> {
  return {
    name: "identity.verifyIdentity:v1",
    maxAttempts: 1,
    timeoutMs: 60_000,
    tags: ["identity", "kyc"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["userId", "documentType", "documentImageUrl"],
      properties: {
        userId: { type: "string", description: "ID del usuario a verificar" },
        documentType: { type: "string", description: "Tipo de documento (DNI, pasaporte...)" },
        documentImageUrl: { type: "string", description: "URL de la imagen del documento" },
      },
      additionalProperties: false,
    },

    async execute(input: VerifyIdentityInput, ctx: ActivityExecutionContext): Promise<VerifyIdentityResult> {
      ctx.log("Verificando identidad", {
        userId: input.userId,
        documentType: input.documentType,
        documentImageUrl: input.documentImageUrl,
      });

      const identity = (await integrationsConfigForActivity(ctx)).identity;
      const providerUrl = identity.providerUrl?.trim();
      const providerToken = identity.providerToken?.trim();
      if (providerUrl && providerToken) {
        const response = await executeHttpRequest(
          {
            url: providerUrl,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${providerToken}`,
            },
            body: {
              userId: input.userId,
              documentType: input.documentType,
              documentImageUrl: input.documentImageUrl,
            },
            timeoutMs: 60_000,
          },
          {
            requireOk: true,
            allowPrivateUrls: true,
          }
        );
        const data =
          response.bodyJson && typeof response.bodyJson === "object"
            ? (response.bodyJson as Partial<VerifyIdentityResult>)
            : {};
        return {
          success: Boolean(data.success),
          score: typeof data.score === "number" ? data.score : 0,
          provider: typeof data.provider === "string" ? data.provider : "kyc-webhook",
        };
      }

      ctx.log("KYC modo demo (sin credenciales de proveedor)", {
        userId: input.userId,
      });
      return {
        success: true,
        score: 0.95,
        provider: "demo",
      };
    },
  };
}
