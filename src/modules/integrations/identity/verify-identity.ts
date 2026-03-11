import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { VerifyIdentityInput, VerifyIdentityResult } from "./types";

export function verifyIdentityActivityDefinition(): ActivityDefinition<VerifyIdentityInput, VerifyIdentityResult> {
    return {
        name: "identity.verifyIdentity:v1",
        maxAttempts: 1,
        timeoutMs: 60_000,
        tags: ["identity", "kyc"],
        version: "1.0.0",
        async execute(input: VerifyIdentityInput, ctx: ActivityExecutionContext): Promise<VerifyIdentityResult> {
            ctx.log("Verificando identidad", {
              userId: input.userId,
              documentType: input.documentType,
              documentImageUrl: input.documentImageUrl,
            });
            // TODO: Integrate with a KYC provider
            return {
              success: true,
              score: 0.98,
              provider: "ExampleKYC",
            };
        }
    }
}