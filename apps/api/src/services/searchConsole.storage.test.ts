import assert from "node:assert/strict";
import test from "node:test";

/** A fake Google: token endpoint, userinfo, Search Console sites and queries. */
function fakeGoogle(log: string[], options: { refreshFails?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body));
      log.push(`token:${body.get("grant_type")}`);
      if (body.get("grant_type") === "authorization_code") {
        return json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/webmasters.readonly" });
      }
      if (options.refreshFails) return json({ error: "invalid_grant" }, 400);
      assert.equal(body.get("refresh_token"), "refresh-1");
      return json({ access_token: "access-2", expires_in: 3600 });
    }
    if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ email: "ali@yellowlime.nl" });
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      log.push("revoke");
      return json({});
    }
    const auth = new Headers(init?.headers).get("authorization");
    log.push(`gsc:${url.replace("https://www.googleapis.com/webmasters/v3", "")}:${auth}`);
    if (url.endsWith("/sites")) return json({ siteEntry: [{ siteUrl: "sc-domain:atlas-gsc.nl", permissionLevel: "siteRestrictedUser" }] });
    const request = JSON.parse(String(init?.body)) as { dimensions?: string[]; startDate: string };
    if (!request.dimensions) return json({ rows: [{ clicks: 120, impressions: 5000, ctr: 0.024, position: 11.4 }] });
    if (request.dimensions[0] === "query" && request.dimensions[1] === "page") {
      return json({ rows: [{ keys: ["e-bike onderhoud", "https://atlas-gsc.nl/onderhoud"], clicks: 12, impressions: 300, position: 4.5 }] });
    }
    if (request.dimensions[0] === "query") {
      return json({ rows: [{ keys: ["e-bike onderhoud"], clicks: 12, impressions: 300, ctr: 0.04, position: 4.5 }, { keys: ["atlas"], clicks: 100, impressions: 400, ctr: 0.25, position: 1 }] });
    }
    // pages: the previous period had more clicks on /oud
    const previous = log.filter((line) => line.includes("searchAnalytics")).length > 3;
    return json({ rows: previous ? [{ keys: ["https://atlas-gsc.nl/oud"], clicks: 50 }] : [{ keys: ["https://atlas-gsc.nl/onderhoud"], clicks: 12 }, { keys: ["https://atlas-gsc.nl/oud"], clicks: 5 }] });
  }) as typeof fetch;
}

test("connects a Google account and reads Search Console data for a partner", { skip: !process.env.DATABASE_URL }, async () => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  const { db, partnersTable, googleConnectionsTable, pool } = await import("@yellowlime/db");
  const { eq } = await import("drizzle-orm");
  const auth = await import("./googleAuth");
  const gsc = await import("./searchConsole");

  const [partner] = await db.insert(partnersTable).values({ companyName: "Atlas GSC", websiteUrl: "https://www.atlas-gsc.nl/" }).returning();
  const log: string[] = [];
  try {
    const config = auth.googleConfig()!;
    const connection = await auth.completeConnection("code-1", "https://app.example/api/google/callback", config, fakeGoogle(log));
    assert.equal(connection.email, "ali@yellowlime.nl");
    assert.ok(!connection.refreshTokenEncrypted.includes("refresh-1"), "refresh token is stored encrypted");

    // A new process has no access token in memory: it is refreshed with the stored refresh token.
    auth.resetGoogleAuthCache();
    gsc.clearSearchConsoleCache();
    const overview = await gsc.partnerSearchConsole(partner.id, 28, { fetcher: fakeGoogle(log) });
    assert.equal(overview?.status, "ok");
    assert.equal(overview?.property, "sc-domain:atlas-gsc.nl");
    assert.equal(overview?.totals?.clicks, 120);
    assert.deepEqual(overview?.opportunities.map((row) => row.key), ["e-bike onderhoud"]);
    assert.ok(log.includes("token:refresh_token"));
    assert.ok(log.some((line) => line.endsWith("Bearer access-2")));

    const topic = await gsc.searchConsolePagesForTopic(partner.websiteUrl, "Onderhoud van je e-bike", fakeGoogle(log));
    assert.equal(topic?.pages[0]?.page, "https://atlas-gsc.nl/onderhoud");

    // A partner whose website is not in the account.
    const [other] = await db.insert(partnersTable).values({ companyName: "Ander", websiteUrl: "https://ander.nl" }).returning();
    const missing = await gsc.partnerSearchConsole(other.id, 90, { fetcher: fakeGoogle(log) });
    assert.equal(missing?.status, "no_property");
    await db.delete(partnersTable).where(eq(partnersTable.id, other.id));

    // Google revokes access: the connection is marked and the app asks to reconnect.
    auth.resetGoogleAuthCache();
    gsc.clearSearchConsoleCache();
    const revoked = await gsc.partnerSearchConsole(partner.id, 90, { fetcher: fakeGoogle(log, { refreshFails: true }) });
    assert.equal(revoked?.status, "not_connected");
    const [row] = await db.select().from(googleConnectionsTable);
    assert.equal(row.lastError, "invalid_grant");

    await auth.disconnect(fakeGoogle(log));
    assert.equal((await db.select().from(googleConnectionsTable)).length, 0);
    assert.ok(log.includes("revoke"));
  } finally {
    await db.delete(googleConnectionsTable);
    await db.delete(partnersTable).where(eq(partnersTable.id, partner.id));
    await pool.end();
  }
});
