import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
let configuredKeyRaw: string | undefined;

export function configureCredentialsEncryptionKey(raw: string | undefined): void {
  configuredKeyRaw = raw?.trim() || undefined;
}

function keyFromConfig(): Buffer {
  const raw = configuredKeyRaw;
  if (!raw) {
    throw new Error("FTN_CREDENTIALS_ENCRYPTION_KEY no configurada");
  }
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length >= 32) {
      return b64.subarray(0, 32);
    }
  } catch {
    /* ignore */
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptCredentials(plain: Record<string, unknown>): string {
  const key = keyFromConfig();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plain), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptCredentials(payload: string): Record<string, unknown> {
  const key = keyFromConfig();
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Payload de credenciales cifradas inválido");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plain) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credenciales descifradas inválidas");
  }
  return parsed as Record<string, unknown>;
}
