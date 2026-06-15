import type { ActivityExecutionContext } from "../../core/activities";
import type { IntegrationsConfig } from "./index";

export type IntegrationsConfigBuilder = (subject: string) => Promise<IntegrationsConfig>;

let buildForSubject: IntegrationsConfigBuilder | undefined;

export function configureIntegrationsRuntime(builder: IntegrationsConfigBuilder): void {
  buildForSubject = builder;
}

export function credentialSubjectFromContext(ctx: ActivityExecutionContext): string {
  return ctx.credentialSubject?.trim() || "system";
}

export async function integrationsConfigForActivity(ctx: ActivityExecutionContext): Promise<IntegrationsConfig> {
  if (!buildForSubject) {
    throw new Error("Integrations runtime no configurado");
  }
  return buildForSubject(credentialSubjectFromContext(ctx));
}

export async function resolveStripeSecretKey(ctx: ActivityExecutionContext): Promise<string> {
  const config = await integrationsConfigForActivity(ctx);
  const key = config.payments.stripeSecretKey?.trim();
  if (!key) {
    throw new Error(
      `Stripe no configurado para el usuario "${credentialSubjectFromContext(ctx)}". Guarda credenciales en Vault o configura STRIPE_SECRET_KEY.`
    );
  }
  return key;
}
