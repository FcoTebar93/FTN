import type { EventStore } from "../modules/event-store";
import { parseCredentialSubjectFromWorkflowName } from "./credential-subject";
import type { IntegrationsConfig } from "../modules/integrations";
import type { BuildIntegrationsConfigInput } from "../infra/bootstrap/integrations";
import { buildIntegrationsConfigForSubject } from "../infra/bootstrap/integrations";

export async function resolveCredentialSubjectForRun(
  eventStore: EventStore,
  workflowId: string,
  runId: string,
  fallback = "system"
): Promise<string> {
  const events = await eventStore.loadEvents(workflowId, runId, 0);
  const started = events.find((e) => e.type === "WorkflowStarted");
  if (!started || started.type !== "WorkflowStarted") {
    return fallback;
  }
  return parseCredentialSubjectFromWorkflowName(started.payload.name) ?? fallback;
}

export async function resolveIntegrationsForRun(
  eventStore: EventStore,
  workflowId: string,
  runId: string,
  integrationsInput: BuildIntegrationsConfigInput,
  fallbackSubject = "system"
): Promise<IntegrationsConfig> {
  const subject = await resolveCredentialSubjectForRun(eventStore, workflowId, runId, fallbackSubject);
  return buildIntegrationsConfigForSubject(subject, integrationsInput);
}

export async function resolveStripeSecretKeyForRun(
  eventStore: EventStore,
  workflowId: string,
  runId: string,
  integrationsInput: BuildIntegrationsConfigInput,
  fallbackSubject = "system"
): Promise<string | undefined> {
  const config = await resolveIntegrationsForRun(eventStore, workflowId, runId, integrationsInput, fallbackSubject);
  return config.payments.stripeSecretKey?.trim() || undefined;
}
