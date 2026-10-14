import { desc, eq } from "drizzle-orm";
import { db, googleConnectionsTable, type GoogleConnection } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { decryptToken, encryptToken, googleConfig, GoogleNotConnectedError, SEARCH_CONSOLE_SCOPE, type GoogleConfig } from "./googleOAuth";

export * from "./googleOAuth";

/**
 * Google sign-in (OAuth 2.0) for Search Console data.
 *
 * One Google account is connected for the whole workspace. Its refresh token is
 * stored encrypted with a key derived from GOOGLE_CLIENT_SECRET (or
 * GOOGLE_TOKEN_SECRET when set), and short-lived access tokens are kept in
 * memory only.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type Fetcher = typeof fetch;

async function tokenRequest(body: Record<string, string>, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof data.error === "string" ? data.error : `http_${response.status}`;
    throw new Error(error);
  }
  return data;
}

/** Exchanges the code from Google's callback and stores the connection. */
export async function completeConnection(code: string, redirectUri: string, config: GoogleConfig, fetcher: Fetcher = fetch): Promise<GoogleConnection> {
  const tokens = await tokenRequest(
    { code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
    fetcher,
  );
  const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
  const scope = typeof tokens.scope === "string" ? tokens.scope : "";
  if (!refreshToken || !accessToken) throw new Error("missing_refresh_token");
  if (!scope.split(" ").includes(SEARCH_CONSOLE_SCOPE)) throw new Error("missing_scope");

  const userinfo = await fetcher(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  const profile = (await userinfo.json().catch(() => ({}))) as { email?: string };
  const email = profile.email ?? "onbekend account";

  cachedAccessToken = { token: accessToken, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 };
  return db.transaction(async (tx) => {
    await tx.delete(googleConnectionsTable);
    const [row] = await tx
      .insert(googleConnectionsTable)
      .values({ email, refreshTokenEncrypted: encryptToken(refreshToken, config), scope })
      .returning();
    return row;
  });
}

export async function currentConnection(): Promise<GoogleConnection | null> {
  const [row] = await db.select().from(googleConnectionsTable).orderBy(desc(googleConnectionsTable.id)).limit(1);
  return row ?? null;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** A valid access token for the connected account, refreshed when needed. */
export async function getAccessToken(fetcher: Fetcher = fetch): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) return cachedAccessToken.token;
  const config = googleConfig();
  const connection = await currentConnection();
  if (!config || !connection || connection.lastError) throw new GoogleNotConnectedError();

  let refreshToken: string;
  try {
    refreshToken = decryptToken(connection.refreshTokenEncrypted, config);
  } catch {
    await markConnectionBroken(connection.id, "token_unreadable");
    throw new GoogleNotConnectedError();
  }
  try {
    const tokens = await tokenRequest(
      { refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" },
      fetcher,
    );
    const token = String(tokens.access_token ?? "");
    if (!token) throw new Error("missing_access_token");
    cachedAccessToken = { token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 };
    return token;
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    if (code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client") {
      await markConnectionBroken(connection.id, code);
      throw new GoogleNotConnectedError();
    }
    throw error;
  }
}

async function markConnectionBroken(id: number, reason: string): Promise<void> {
  cachedAccessToken = null;
  logger.warn({ reason }, "Google connection is no longer valid");
  await db.update(googleConnectionsTable).set({ lastError: reason }).where(eq(googleConnectionsTable.id, id));
}

/** Removes the connection and asks Google to revoke the token. */
export async function disconnect(fetcher: Fetcher = fetch): Promise<void> {
  const config = googleConfig();
  const connection = await currentConnection();
  cachedAccessToken = null;
  if (connection && config) {
    try {
      const token = decryptToken(connection.refreshTokenEncrypted, config);
      await fetcher(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logger.warn({ errorType: error instanceof Error ? error.message : typeof error }, "Google token revoke failed");
    }
  }
  await db.delete(googleConnectionsTable);
}

/** For tests. */
export function resetGoogleAuthCache(): void {
  cachedAccessToken = null;
}
