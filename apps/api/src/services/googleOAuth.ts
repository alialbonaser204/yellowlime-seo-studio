import crypto from "node:crypto";

/**
 * Pure helpers for Google sign-in (OAuth 2.0): configuration, token
 * encryption and the signed `state` value. No database access, so they can be
 * unit tested on their own.
 */

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"];
export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_MAX_AGE_MS = 10 * 60_000;

export class GoogleNotConnectedError extends Error {
  constructor(message = "google_not_connected") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || undefined };
}

function encryptionKey(config: GoogleConfig): Buffer {
  const secret = process.env.GOOGLE_TOKEN_SECRET?.trim() || config.clientSecret;
  return crypto.createHash("sha256").update(`yellowlime-google-token:${secret}`).digest();
}

export function encryptToken(token: string, config: GoogleConfig): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(value: string, config: GoogleConfig): string {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("invalid_token_format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(config), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

function sign(value: string, config: GoogleConfig): string {
  return crypto.createHmac("sha256", encryptionKey(config)).update(value).digest("base64url");
}

/**
 * The OAuth `state`: a random nonce (also stored in a cookie, so the callback
 * must come back to the same browser), a timestamp and the page to return to,
 * signed so it cannot be altered.
 */
export function createState(returnTo: string, config: GoogleConfig, now = Date.now()): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ n: nonce, t: now, r: safeReturnPath(returnTo) })).toString("base64url");
  return { state: `${payload}.${sign(payload, config)}`, nonce };
}

export function verifyState(state: string, nonce: string | undefined, config: GoogleConfig, now = Date.now()): { returnTo: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !nonce) return null;
  const expected = sign(payload, config);
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { n: string; t: number; r: string };
    if (data.n !== nonce || typeof data.t !== "number" || now - data.t > STATE_MAX_AGE_MS || data.t > now + 60_000) return null;
    return { returnTo: safeReturnPath(data.r) };
  } catch {
    return null;
  }
}

/** Only allow returning to a path inside this app (never another site). */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.startsWith("/api")) return "/";
  return value.slice(0, 300);
}

export function authorizationUrl(config: GoogleConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}
