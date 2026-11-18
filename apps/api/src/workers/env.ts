import { env } from "cloudflare:workers";

/**
 * The code reads settings from process.env, like on a Node server. Copy the
 * Worker's variables and secrets there. The names are listed explicitly,
 * because Cloudflare's `env` object cannot always be listed with Object.keys.
 */
const NAMES = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "SEMRUSH_API_KEY",
  "ALLOWED_EMAIL_DOMAINS",
  "SEMRUSH_MODE",
  "SEMRUSH_MCP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_TOKEN_SECRET",
  "CORS_ORIGIN",
  "LOG_LEVEL",
  "NODE_ENV",
];

export function copyWorkerSettings(source: Record<string, unknown> = env): void {
  const names = new Set([...NAMES, ...Object.keys(source)]);
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value !== "") process.env[name] = value;
  }
}

copyWorkerSettings();
