/**
 * Login helpers: e-mail rules, password hashing and session tokens.
 *
 * Uses Web Crypto (PBKDF2-SHA256), which works the same in Node and on
 * Cloudflare Workers. Workers allow at most 100.000 PBKDF2 iterations.
 */

export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 10;
export const SESSION_DAYS = 30;
export const SESSION_COOKIE = "yl_session";
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/** Domains whose addresses may create an account (comma-separated in ALLOWED_EMAIL_DOMAINS). */
export function allowedDomains(): string[] {
  const configured = process.env.ALLOWED_EMAIL_DOMAINS?.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return configured?.length ? configured : ["yellowlime.nl"];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True for a plausible address whose domain is exactly one of the allowed domains. */
export function isAllowedEmail(email: string, domains = allowedDomains()): boolean {
  const normalized = normalizeEmail(email);
  const match = normalized.match(/^[^\s@]+@([^\s@]+)$/);
  if (!match) return false;
  return domains.includes(match[1]);
}

/** Returns a Dutch message when the password is too weak, otherwise null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Kies een wachtwoord van minstens ${MIN_PASSWORD_LENGTH} tekens.`;
  if (password.length > 200) return "Dit wachtwoord is te lang.";
  return null;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const expected = fromB64(hash);
  const actual = await pbkdf2(password, fromB64(salt), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** A random token for the cookie; only its hash is stored in the database. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds = SESSION_DAYS * 24 * 3600): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}
