import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { db, sessionsTable, usersTable, type User } from "@yellowlime/db";
import {
  CODE_MINUTES,
  CODE_RESEND_SECONDS,
  LOCK_MINUTES,
  MAX_CODE_ATTEMPTS,
  MAX_FAILED_LOGINS,
  SESSION_COOKIE,
  SESSION_DAYS,
  allowedDomains,
  clearedSessionCookie,
  hashPassword,
  hashToken,
  isAllowedEmail,
  newSessionToken,
  newVerificationCode,
  normalizeEmail,
  passwordProblem,
  readCookie,
  sessionCookie,
  verifyPassword,
} from "../services/auth";
import { mailConfigured, sendMail, verificationMail } from "../services/mailer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * E-mail verification is only required when EMAIL_VERIFICATION=on and an
 * e-mail service is set up. Otherwise accounts work right after sign-up.
 */
export function verificationOn(): boolean {
  return process.env.EMAIL_VERIFICATION?.trim().toLowerCase() === "on" && mailConfigured();
}

const isSecure = (req: Request) => req.protocol === "https";
const publicUser = (user: Pick<User, "id" | "email" | "name">) => ({ id: user.id, email: user.email, name: user.name });
const str = (value: unknown) => (typeof value === "string" ? value : "");

async function startSession(req: Request, res: Response, userId: number) {
  const token = newSessionToken();
  await db.insert(sessionsTable).values({
    id: await hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3600_000),
  });
  // Tidy up expired sessions of this user.
  await db.delete(sessionsTable).where(and(eq(sessionsTable.userId, userId), lt(sessionsTable.expiresAt, new Date())));
  res.setHeader("Set-Cookie", sessionCookie(token, isSecure(req)));
}

async function userFromRequest(req: Request) {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(and(
      eq(sessionsTable.id, await hashToken(token)),
      gt(sessionsTable.expiresAt, new Date()),
      verificationOn() ? isNotNull(usersTable.emailVerifiedAt) : undefined,
    ))
    .limit(1);
  return row ?? null;
}

type CodeResult = "sent" | "too_soon" | "mail_not_configured" | "mail_failed";

/** Makes a new code, stores its hash and e-mails it. */
async function sendCode(user: Pick<User, "id" | "email" | "name" | "verifyCodeSentAt">, force = false): Promise<CodeResult> {
  if (!mailConfigured()) return "mail_not_configured";
  if (!force && user.verifyCodeSentAt && Date.now() - user.verifyCodeSentAt.getTime() < CODE_RESEND_SECONDS * 1000) return "too_soon";
  const code = newVerificationCode();
  await db.update(usersTable).set({
    verifyCodeHash: await hashToken(`${user.id}:${code}`),
    verifyCodeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
    verifyCodeSentAt: new Date(),
    verifyCodeAttempts: 0,
  }).where(eq(usersTable.id, user.id));
  try {
    await sendMail(verificationMail(user.email, user.name, code, CODE_MINUTES));
    return "sent";
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Verification mail failed");
    return "mail_failed";
  }
}

function codeResponse(res: Response, email: string, result: CodeResult, status = 202) {
  if (result === "mail_not_configured") {
    res.status(503).json({ error: "Het versturen van e-mail is nog niet ingesteld. Vraag de beheerder om dit in te stellen." });
    return;
  }
  if (result === "mail_failed") {
    res.status(502).json({ error: "De e-mail met je code kon niet verstuurd worden. Probeer het over een minuut opnieuw." });
    return;
  }
  res.status(status).json({ needsCode: true, email, codeMinutes: CODE_MINUTES, resent: result === "sent" });
}

router.get("/auth/me", async (req, res) => {
  const user = await userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Niet ingelogd.", domains: allowedDomains() });
    return;
  }
  res.json({ user: publicUser(user) });
});

router.post("/auth/register", async (req, res) => {
  const name = str(req.body?.name).trim();
  const email = normalizeEmail(str(req.body?.email));
  const password = str(req.body?.password);
  if (name.length < 2 || name.length > 80) {
    res.status(400).json({ error: "Vul je naam in." });
    return;
  }
  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: `Alleen e-mailadressen van ${allowedDomains().map((d) => `@${d}`).join(" of ")} kunnen een account maken.` });
    return;
  }
  const weak = passwordProblem(password);
  if (weak) {
    res.status(400).json({ error: weak });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing && (existing.emailVerifiedAt || !verificationOn())) {
    res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres. Log in." });
    return;
  }
  // A never-verified account may be claimed again: only whoever reads the
  // mailbox can finish it, so nobody can block an address by registering first.
  const passwordHash = await hashPassword(password);
  if (!verificationOn()) {
    const [user] = await db.insert(usersTable).values({ name, email, passwordHash, lastLoginAt: new Date() }).returning();
    await startSession(req, res, user.id);
    res.status(201).json({ user: publicUser(user) });
    return;
  }
  const [user] = existing
    ? await db.update(usersTable).set({ name, passwordHash }).where(eq(usersTable.id, existing.id)).returning()
    : await db.insert(usersTable).values({ name, email, passwordHash }).returning();
  codeResponse(res, email, await sendCode(user, !existing));
});

router.post("/auth/verify", async (req, res) => {
  const email = normalizeEmail(str(req.body?.email));
  const code = str(req.body?.code).replace(/\D/g, "");
  const wrong = (message = "Deze code klopt niet.") => res.status(400).json({ error: message });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !user.verifyCodeHash || !user.verifyCodeExpiresAt) {
    wrong("Vraag eerst een nieuwe code aan.");
    return;
  }
  if (user.verifyCodeExpiresAt < new Date()) {
    wrong("Deze code is verlopen. Vraag een nieuwe code aan.");
    return;
  }
  if (user.verifyCodeAttempts >= MAX_CODE_ATTEMPTS) {
    wrong("Te vaak een verkeerde code. Vraag een nieuwe code aan.");
    return;
  }
  if (code.length !== 6 || (await hashToken(`${user.id}:${code}`)) !== user.verifyCodeHash) {
    await db.update(usersTable).set({ verifyCodeAttempts: user.verifyCodeAttempts + 1 }).where(eq(usersTable.id, user.id));
    wrong();
    return;
  }
  await db.update(usersTable).set({
    emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    verifyCodeHash: null,
    verifyCodeExpiresAt: null,
    verifyCodeAttempts: 0,
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  }).where(eq(usersTable.id, user.id));
  await startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post("/auth/resend", async (req, res) => {
  const email = normalizeEmail(str(req.body?.email));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  // Same answer whether or not the address exists.
  if (!user || user.emailVerifiedAt) {
    res.status(202).json({ needsCode: true, email, codeMinutes: CODE_MINUTES, resent: false });
    return;
  }
  const result = await sendCode(user);
  if (result === "too_soon") {
    res.status(429).json({ error: `Wacht een minuut voordat je een nieuwe code aanvraagt.` });
    return;
  }
  codeResponse(res, email, result);
});

router.post("/auth/login", async (req, res) => {
  const email = normalizeEmail(str(req.body?.email));
  const password = str(req.body?.password);
  const wrong = () => res.status(401).json({ error: "E-mailadres of wachtwoord klopt niet." });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) {
    // Same work as a real check, so the answer time does not reveal which addresses exist.
    await hashPassword(password);
    wrong();
    return;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    res.status(429).json({ error: `Te vaak een verkeerd wachtwoord. Probeer het over ${LOCK_MINUTES} minuten opnieuw.` });
    return;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await db
      .update(usersTable)
      .set(failed >= MAX_FAILED_LOGINS
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLogins: failed })
      .where(eq(usersTable.id, user.id));
    wrong();
    return;
  }
  if (!user.emailVerifiedAt && verificationOn()) {
    // Right password, but the address is not confirmed yet: send a code.
    const result = await sendCode(user);
    codeResponse(res, email, result === "too_soon" ? "sent" : result, 403);
    return;
  }
  await db.update(usersTable).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  await startSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post("/auth/logout", async (req, res) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (token) await db.delete(sessionsTable).where(eq(sessionsTable.id, await hashToken(token)));
  res.setHeader("Set-Cookie", clearedSessionCookie(isSecure(req)));
  res.status(204).end();
});

/** Every API route after this one needs a logged-in, verified user. */
export async function requireLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Log eerst in." });
      return;
    }
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export default router;
