import type {
  GoogleServiceAccountCredentials,
  GoogleSheetsAuthConfig,
  GoogleSheetsOAuthAuthConfig,
  GoogleSheetsServiceAccountAuthConfig,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function parseServiceAccountJson(raw: unknown): GoogleServiceAccountCredentials {
  let parsed: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("google_sheets: serviceAccountJson no es JSON válido");
    }
  } else {
    const rec = asRecord(raw);
    if (!rec) {
      throw new Error("google_sheets: falta serviceAccountJson o clientEmail/privateKey");
    }
    parsed = rec;
  }

  const clientEmail =
    readString(parsed, "client_email") ?? readString(parsed, "clientEmail");
  const privateKey =
    readString(parsed, "private_key") ?? readString(parsed, "privateKey");

  if (!clientEmail || !privateKey) {
    throw new Error("google_sheets: service account debe incluir client_email y private_key");
  }

  return {
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, "\n"),
  };
}

export function resolveServiceAccountFromSecrets(secrets: Record<string, unknown>): GoogleServiceAccountCredentials | undefined {
  const json =
    secrets.serviceAccountJson ??
    secrets.service_account_json ??
    secrets.googleServiceAccountJson;

  if (json !== undefined) {
    return parseServiceAccountJson(json);
  }

  const clientEmail =
    (typeof secrets.clientEmail === "string" && secrets.clientEmail.trim()) ||
    (typeof secrets.client_email === "string" && secrets.client_email.trim());
  const privateKey =
    (typeof secrets.privateKey === "string" && secrets.privateKey.trim()) ||
    (typeof secrets.private_key === "string" && secrets.private_key.trim());

  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return undefined;
}

export function resolveOAuthRefreshTokenFromSecrets(secrets: Record<string, unknown>): string | undefined {
  const token =
    (typeof secrets.refreshToken === "string" && secrets.refreshToken.trim()) ||
    (typeof secrets.refresh_token === "string" && secrets.refresh_token.trim());
  return token || undefined;
}

export interface BuildGoogleSheetsAuthInput {
  credentialSecrets?: Record<string, unknown>;
  credentialConfig?: Record<string, unknown>;
  serviceAccountJsonEnv?: string;
  impersonateEmailEnv?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUri?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function buildGoogleSheetsAuthConfig(input: BuildGoogleSheetsAuthInput): GoogleSheetsAuthConfig | undefined {
  const secrets = input.credentialSecrets ?? {};
  const config = input.credentialConfig ?? {};
  const refreshToken = resolveOAuthRefreshTokenFromSecrets(secrets);
  const authType = str(config.authType);

  if (
    refreshToken &&
    input.oauthClientId &&
    input.oauthClientSecret &&
    input.oauthRedirectUri &&
    (authType === "oauth2" || !resolveServiceAccountFromSecrets(secrets))
  ) {
    return {
      kind: "oauth2",
      clientId: input.oauthClientId,
      clientSecret: input.oauthClientSecret,
      redirectUri: input.oauthRedirectUri,
      refreshToken,
    } satisfies GoogleSheetsOAuthAuthConfig;
  }

  const serviceAccountFromCredential = resolveServiceAccountFromSecrets(secrets);
  const serviceAccountFromEnv = input.serviceAccountJsonEnv
    ? resolveServiceAccountFromSecrets({ serviceAccountJson: input.serviceAccountJsonEnv })
    : undefined;
  const serviceAccount = serviceAccountFromCredential ?? serviceAccountFromEnv;
  if (!serviceAccount) {
    return undefined;
  }

  const impersonateEmail =
    str(config.impersonateEmail) ?? str(config.delegatedUser) ?? input.impersonateEmailEnv;

  return {
    kind: "service_account",
    serviceAccount,
    ...(impersonateEmail ? { impersonateEmail } : {}),
  } satisfies GoogleSheetsServiceAccountAuthConfig;
}
