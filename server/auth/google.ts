import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAuthConfig } from "./config.js";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

export type GoogleIdentity = { subject: string; email: string; name: string | null };
export type OAuthStatePayload = { state: string; verifier: string; next: string };

export function isGoogleSignInConfigured(): boolean {
  const config = getAuthConfig();
  return Boolean(config.googleClientId && config.googleClientSecret);
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildGoogleAuthorizationUrl(params: { redirectUri: string; state: string; codeChallenge: string }): string {
  const config = getAuthConfig();
  if (!config.googleClientId) throw new Error("Google sign-in is not configured.");
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeGoogleCode(params: { code: string; redirectUri: string; codeVerifier: string }): Promise<GoogleIdentity> {
  const config = getAuthConfig();
  if (!config.googleClientId || !config.googleClientSecret) throw new Error("Google sign-in is not configured.");

  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed with HTTP ${tokenResponse.status}.`);
  const tokenPayload = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenPayload.id_token) throw new Error("Google did not return an ID token.");

  // tokeninfo verifies the JWT signature, audience, issuer, and expiry server-side without us
  // needing to fetch and cache Google's JWKS ourselves — simple and appropriate at this project's scale.
  const infoResponse = await fetch(`${GOOGLE_TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(tokenPayload.id_token)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!infoResponse.ok) throw new Error(`Google ID token verification failed with HTTP ${infoResponse.status}.`);
  const info = (await infoResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: string;
    name?: string;
    aud?: string;
  };
  if (!info.sub || !info.email || info.email_verified !== "true" || info.aud !== config.googleClientId) {
    throw new Error("Google ID token failed verification.");
  }
  return { subject: info.sub, email: info.email.toLowerCase(), name: info.name?.trim() || null };
}

const OAUTH_STATE_COOKIE = "openbucket_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function safeNext(value: string | null): string {
  return value === "/dashboard" || value?.startsWith("/dashboard?") ? value : "/dashboard";
}

export function encodeOAuthState(authSecret: Buffer, payload: OAuthStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", authSecret).update(encoded).digest("base64url");
  return `${encoded}.${mac}`;
}

export function decodeOAuthState(authSecret: Buffer, token: string): OAuthStatePayload | null {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const mac = token.slice(separator + 1);
  const expectedMac = createHmac("sha256", authSecret).update(encoded).digest("base64url");
  const suppliedBuffer = Buffer.from(mac, "base64url");
  const expectedBuffer = Buffer.from(expectedMac, "base64url");
  if (suppliedBuffer.byteLength !== expectedBuffer.byteLength || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
    if (typeof payload.state !== "string" || typeof payload.verifier !== "string") return null;
    return { state: payload.state, verifier: payload.verifier, next: safeNext(payload.next ?? null) };
  } catch {
    return null;
  }
}

export function oAuthStateCookie(secure: boolean, value: string): string {
  return `${OAUTH_STATE_COOKIE}=${value}; Path=/; Max-Age=${OAUTH_STATE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearedOAuthStateCookie(secure: boolean): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function readOAuthStateCookie(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === OAUTH_STATE_COOKIE) return part.slice(separator + 1).trim();
  }
  return null;
}
