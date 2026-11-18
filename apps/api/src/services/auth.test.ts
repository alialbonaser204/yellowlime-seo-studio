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

test("verification codes are 6 digits", async () => {
  const { newVerificationCode } = await import("./auth");
  for (let i = 0; i < 50; i++) assert.match(newVerificationCode(), /^\d{6}$/);
});

test("Brevo mail is sent with the code and the configured sender", async () => {
  const { sendMail, verificationMail, mailConfigured } = await import("./mailer");
  process.env.MAIL_FROM = "agent@example.com";
  process.env.BREVO_API_KEY = "test-key";
  assert.ok(mailConfigured());
  let sent: { url: string; body: any; key: string | null } | null = null;
  const fetcher = (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("api-key") };
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
  await sendMail(verificationMail("ali@yellowlime.nl", "Ali Test", "123456", 15), fetcher);
  assert.equal(sent!.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(sent!.key, "test-key");
  assert.equal(sent!.body.sender.email, "agent@example.com");
  assert.equal(sent!.body.to[0].email, "ali@yellowlime.nl");
  assert.match(sent!.body.subject, /123456/);
  assert.match(sent!.body.htmlContent, /Hoi Ali/);
  delete process.env.BREVO_API_KEY;
  assert.ok(!mailConfigured());
  delete process.env.MAIL_FROM;
});

test("mail text escapes the name", async () => {
  const { verificationMail } = await import("./mailer");
  assert.ok(!verificationMail("a@yellowlime.nl", "<script>", "000001", 15).html.includes("<script>"));
});
