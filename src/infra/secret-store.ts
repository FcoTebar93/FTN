import type { SecretStore } from "../modules/secret-store";
import { decryptCredentials, encryptCredentials } from "./credentials";

export type SecretStoreBackend = "encrypted" | "vault";

class EncryptedSecretStore implements SecretStore {
  async save(_subject: string, _provider: string, secret: Record<string, unknown>): Promise<string> {
    return encryptCredentials(secret);
  }

  async load(reference: string): Promise<Record<string, unknown>> {
    return decryptCredentials(reference);
  }

  isManagedReference(_reference: string): boolean {
    return false;
  }
}

interface VaultSecretStoreConfig {
  address: string;
  token: string;
  mount: string;
  pathPrefix: string;
  timeoutMs: number;
}

class VaultSecretStore implements SecretStore {
  private readonly address: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly pathPrefix: string;
  private readonly timeoutMs: number;

  constructor(config: VaultSecretStoreConfig) {
    this.address = config.address.replace(/\/+$/, "");
    this.token = config.token;
    this.mount = config.mount.replace(/^\/+|\/+$/g, "");
    this.pathPrefix = config.pathPrefix.replace(/^\/+|\/+$/g, "");
    this.timeoutMs = config.timeoutMs;
  }

  async save(subject: string, provider: string, secret: Record<string, unknown>): Promise<string> {
    const path = this.buildPath(subject, provider);
    await this.callVault("POST", `/v1/${this.mount}/data/${path}`, { data: secret });
    return this.toReference(path);
  }

  async load(reference: string): Promise<Record<string, unknown>> {
    const path = this.fromReference(reference);
    const payload = (await this.callVault("GET", `/v1/${this.mount}/data/${path}`)) as {
      data?: { data?: unknown };
    };
    const data = payload.data?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Vault devolvió secretos inválidos");
    }
    return data as Record<string, unknown>;
  }

  isManagedReference(reference: string): boolean {
    return reference.startsWith("vault:");
  }

  private buildPath(subject: string, provider: string): string {
    const encodedSubject = encodeURIComponent(subject.trim());
    const encodedProvider = encodeURIComponent(provider.trim());
    return `${this.pathPrefix}/${encodedSubject}/${encodedProvider}`;
  }

  private toReference(path: string): string {
    return `vault:${path}`;
  }

  private fromReference(reference: string): string {
    if (!this.isManagedReference(reference)) {
      throw new Error("Referencia de Vault inválida");
    }
    return reference.slice("vault:".length);
  }

  private async callVault(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.address}${path}`, {
        method,
        headers: {
          "X-Vault-Token": this.token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Vault error ${response.status}: ${text}`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class SecretStoreFacade {
  private readonly activeStore: SecretStore;

  constructor(activeStore: SecretStore) {
    this.activeStore = activeStore;
  }

  async save(subject: string, provider: string, secret: Record<string, unknown>): Promise<string> {
    return this.activeStore.save(subject, provider, secret);
  }

  async load(reference: string): Promise<Record<string, unknown>> {
    if (this.activeStore.isManagedReference(reference)) {
      return this.activeStore.load(reference);
    }
    return decryptCredentials(reference);
  }

  isManagedReference(reference: string): boolean {
    return this.activeStore.isManagedReference(reference);
  }
}

let secretStore: SecretStore = new SecretStoreFacade(new EncryptedSecretStore());

export function configureSecretStore(nextStore: SecretStore): void {
  secretStore = new SecretStoreFacade(nextStore);
}

export function getSecretStore(): SecretStore {
  return secretStore;
}

interface BuildSecretStoreConfig {
  backend: SecretStoreBackend;
  vaultAddress?: string;
  vaultToken?: string;
  vaultMount: string;
  vaultPathPrefix: string;
  vaultTimeoutMs: number;
}

export function buildSecretStore(config: BuildSecretStoreConfig): SecretStore {
  if (config.backend === "vault") {
    if (!config.vaultAddress) {
      throw new Error("Falta FTN_VAULT_ADDR para usar Vault como SecretStore");
    }
    if (!config.vaultToken) {
      throw new Error("Falta FTN_VAULT_TOKEN para usar Vault como SecretStore");
    }
    return new VaultSecretStore({
      address: config.vaultAddress,
      token: config.vaultToken,
      mount: config.vaultMount,
      pathPrefix: config.vaultPathPrefix,
      timeoutMs: config.vaultTimeoutMs,
    });
  }
  return new EncryptedSecretStore();
}
