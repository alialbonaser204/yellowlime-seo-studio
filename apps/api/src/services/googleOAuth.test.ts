import assert from "node:assert/strict";
import test from "node:test";
import { authorizationUrl, createState, decryptToken, encryptToken, safeReturnPath, verifyState } from "./googleOAuth";

const config = { clientId: "client-id", clientSecret: "client-secret" };

test("encrypts refresh tokens so they can only be read with the same secret", () => {
  const stored = encryptToken("1//refresh-token", config);
  assert.ok(!stored.includes("refresh-token"));
  assert.equal(decryptToken(stored, config), "1//refresh-token");
  assert.throws(() => decryptToken(stored, { ...config, clientSecret: "other" }));
});

test("accepts only an unaltered, recent state from the same browser", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const { state, nonce } = createState("/partners/3", config, now);
  assert.deepEqual(verifyState(state, nonce, config, now + 60_000), { returnTo: "/partners/3" });
  assert.equal(verifyState(state, "other-nonce", config, now), null, "different browser");
  assert.equal(verifyState(state, undefined, config, now), null, "no cookie");
  assert.equal(verifyState(state, nonce, config, now + 11 * 60_000), null, "expired");
  assert.equal(verifyState(`x${state}`, nonce, config, now), null, "altered");
  assert.equal(verifyState(state, nonce, { ...config, clientSecret: "other" }, now), null, "other secret");
});

test("only returns to pages inside the app", () => {
  assert.equal(safeReturnPath("/partners/1"), "/partners/1");
  assert.equal(safeReturnPath("https://evil.example"), "/");
  assert.equal(safeReturnPath("//evil.example"), "/");
  assert.equal(safeReturnPath("/\\evil.example"), "/");
  assert.equal(safeReturnPath("/api/google/connect"), "/");
  assert.equal(safeReturnPath(undefined), "/");
});

test("asks Google for read-only Search Console access and a refresh token", () => {
  const url = new URL(authorizationUrl(config, "https://app.example/api/google/callback", "abc"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/webmasters.readonly");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/google/callback");
  assert.equal(url.searchParams.get("state"), "abc");
});
