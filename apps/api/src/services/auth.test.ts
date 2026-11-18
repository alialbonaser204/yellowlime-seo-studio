import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, isAllowedEmail, passwordProblem, readCookie, sessionCookie, hashToken, newSessionToken } from "./auth";

test("only exact Yellowlime addresses are allowed", () => {
  assert.ok(isAllowedEmail("Ali@Yellowlime.nl", ["yellowlime.nl"]));
  assert.ok(!isAllowedEmail("ali@yellowlime.nl.evil.com", ["yellowlime.nl"]));
  assert.ok(!isAllowedEmail("ali@notyellowlime.nl", ["yellowlime.nl"]));
  assert.ok(!isAllowedEmail("ali@sub.yellowlime.nl", ["yellowlime.nl"]));
  assert.ok(!isAllowedEmail("yellowlime.nl", ["yellowlime.nl"]));
});

test("passwords are hashed and verified", async () => {
  const stored = await hashPassword("een-lang-wachtwoord", 1000);
  assert.match(stored, /^pbkdf2\$1000\$/);
  assert.ok(await verifyPassword("een-lang-wachtwoord", stored));
  assert.ok(!(await verifyPassword("een-ander-wachtwoord", stored)));
  assert.notEqual(stored, await hashPassword("een-lang-wachtwoord", 1000));
});

test("weak passwords are refused", () => {
  assert.ok(passwordProblem("kort"));
  assert.equal(passwordProblem("lang-genoeg-123"), null);
});

test("session cookie is HttpOnly and only the token hash is stored", async () => {
  const token = newSessionToken();
  const cookie = sessionCookie(token, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(readCookie(`a=1; yl_session=${token}; b=2`, "yl_session"), token);
  assert.equal((await hashToken(token)).length, 64);
  assert.notEqual(await hashToken(token), token);
});
