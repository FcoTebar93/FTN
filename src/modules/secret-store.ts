export interface SecretStore {
  save(subject: string, provider: string, secret: Record<string, unknown>): Promise<string>;
  load(reference: string): Promise<Record<string, unknown>>;
  isManagedReference(reference: string): boolean;
}
