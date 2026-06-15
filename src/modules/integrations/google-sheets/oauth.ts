import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

export const GOOGLE_SHEETS_OAUTH_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export interface GoogleSheetsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSigningSecret: string;
}

interface OAuthStatePayload {
  sub: string;
  exp: number;
  nonce: string;
}

export interface GoogleOAuthTokens {
  refreshToken: string;
  accessToken?: string;
  email?: string;
}

function signPayload(payload: OAuthStatePayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function createGoogleSheetsOAuthState(subject: string, secret: string, ttlMs = 10 * 60 * 1000): string {
  const payload: OAuthStatePayload = {
    sub: subject,
    exp: Date.now() + ttlMs,
    nonce: randomBytes(16).toString("hex"),
  };
  return signPayload(payload, secret);
}

export function verifyGoogleSheetsOAuthState(state: string, secret: string): { subject: string } | undefined {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const data = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return undefined;
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return undefined;
  }
  if (typeof payload.sub !== "string" || !payload.sub.trim()) {
    return undefined;
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return undefined;
  }
  return { subject: payload.sub };
}

export function buildGoogleSheetsAuthorizationUrl(
  config: GoogleSheetsOAuthConfig,
  state: string
): string {
  const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GOOGLE_SHEETS_OAUTH_SCOPE],
    state,
    include_granted_scopes: true,
  });
}

async function fetchGoogleAccountEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return undefined;
  }
  const body = (await res.json()) as { email?: string };
  return typeof body.email === "string" && body.email.trim() ? body.email.trim() : undefined;
}

export async function exchangeGoogleSheetsOAuthCode(
  config: GoogleSheetsOAuthConfig,
  code: string
): Promise<GoogleOAuthTokens> {
  const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  const { tokens } = await client.getToken(code);
  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    throw new Error("google_sheets_oauth: Google no devolvió refresh_token; prueba revocar acceso y reconectar");
  }
  const accessToken = tokens.access_token ?? undefined;
  const email = accessToken ? await fetchGoogleAccountEmail(accessToken) : undefined;
  return { refreshToken, accessToken, email };
}
