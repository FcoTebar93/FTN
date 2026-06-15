export function parseCredentialSubjectFromWorkflowName(workflowName: string): string | undefined {
  const trimmed = workflowName.trim();
  if (!trimmed.includes("::")) {
    return undefined;
  }
  const sep = trimmed.lastIndexOf("::");
  const ownerPart = trimmed.slice(0, sep).trim();
  if (!ownerPart) {
    return undefined;
  }
  return ownerPart;
}

export function resolveCredentialSubject(workflowName: string, fallback = "system"): string {
  return parseCredentialSubjectFromWorkflowName(workflowName) ?? fallback;
}