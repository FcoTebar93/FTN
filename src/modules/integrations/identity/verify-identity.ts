import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import { executeHttpRequest } from "../http/client";
import type { VerifyIdentityInput, VerifyIdentityResult } from "./types";

export function verifyIdentityActivityDefinition(): ActivityDefinition<VerifyIdentityInput, VerifyIdentityResult> {
    return {
        name: "identity.verifyIdentity:v1",
        maxAttempts: 1,
        timeoutMs: 60_000,
        tags: ["identity", "kyc"],
        version: "1.0.0",
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

            const providerUrl = process.env.KYC_PROVIDER_URL?.trim();
            const providerToken = process.env.KYC_PROVIDER_TOKEN?.trim();
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
                  // Mantiene compatibilidad con proveedores internos.
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

            ctx.log("KYC modo demo (sin KYC_PROVIDER_URL + KYC_PROVIDER_TOKEN)", {
              userId: input.userId,
            });
            return {
              success: true,
              score: 0.95,
              provider: "demo",
            };
        }
    }
}