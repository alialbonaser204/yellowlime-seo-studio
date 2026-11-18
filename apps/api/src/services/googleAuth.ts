import { desc, eq, isNull } from "drizzle-orm";
import { db, googleConnectionsTable, type GoogleConnection } from "@yellowlime/db";
import { logger } from "../lib/logger";
import { currentUser } from "../lib/requestUser";
import { decryptToken, encryptToken, googleConfig, GoogleNotConnectedError, SEARCH_CONSOLE_SCOPE, type GoogleConfig } from "./googleOAuth";

export * from "./googleOAuth";

/**
 * Google sign-in (OAuth 2.0) for Search Console data.
 *
 * Every Yellowlimer can connect their own Google account. Someone without an
 * own (working) connection uses the most recent working connection of a
 * colleague, so one account with access to all partners is enough. Refresh tokens are
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

  const userId = currentUser()?.id ?? null;
  const row = await db.transaction(async (tx) => {
    // One connection per Yellowlimer: replace their previous one.
    await tx.delete(googleConnectionsTable).where(userId === null ? isNull(googleConnectionsTable.userId) : eq(googleConnectionsTable.userId, userId));
    const [inserted] = await tx
      .insert(googleConnectionsTable)
      .values({ userId, email, refreshTokenEncrypted: encryptToken(refreshToken, config), scope })
      .returning();
    return inserted;
  });
  accessTokens.set(row.id, { token: accessToken, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 });
  return row;
}

/** The logged-in Yellowlimer's own connection (working or not). */
export async function ownConnection(): Promise<GoogleConnection | null> {
  const userId = currentUser()?.id;
  if (!userId) return null;
  const [row] = await db.select().from(googleConnectionsTable)
    .where(eq(googleConnectionsTable.userId, userId))
    .orderBy(desc(googleConnectionsTable.id)).limit(1);
  return row ?? null;
}

/** A colleague's working connection, for someone without their own. */
export async function sharedConnection(): Promise<GoogleConnection | null> {
  const [row] = await db.select().from(googleConnectionsTable)
    .where(isNull(googleConnectionsTable.lastError))
    .orderBy(desc(googleConnectionsTable.id)).limit(1);
  return row ?? null;
}

/** The connection to use now: your own when it works, otherwise a colleague's. */
export async function currentConnection(): Promise<GoogleConnection | null> {
  const own = await ownConnection();
  if (own && !own.lastError) return own;
  return (await sharedConnection()) ?? own;
}

const accessTokens = new Map<number, { token: string; expiresAt: number }>();

/** A valid access token for the connection in use, refreshed when needed. */
export async function getAccessToken(fetcher: Fetcher = fetch): Promise<string> {
  const config = googleConfig();
  const connection = await currentConnection();
  if (!config || !connection || connection.lastError) throw new GoogleNotConnectedError();
  const cached = accessTokens.get(connection.id);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

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
    accessTokens.set(connection.id, { token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60_000 });
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
  accessTokens.delete(id);
  logger.warn({ reason }, "Google connection is no longer valid");
  await db.update(googleConnectionsTable).set({ lastError: reason }).where(eq(googleConnectionsTable.id, id));
}

/** Removes your own connection and asks Google to revoke the token. */
export async function disconnect(fetcher: Fetcher = fetch): Promise<void> {
  const config = googleConfig();
  const connection = await ownConnection();
  if (!connection) return;
  accessTokens.delete(connection.id);
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
  await db.delete(googleConnectionsTable).where(eq(googleConnectionsTable.id, connection.id));
}

/** For tests. */
export function resetGoogleAuthCache(): void {
  accessTokens.clear();
}
