import { and, eq, gt, lt } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { db, sessionsTable, usersTable, type User } from "@yellowlime/db";
import {
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  SESSION_COOKIE,
  SESSION_DAYS,
  allowedDomains,
  clearedSessionCookie,
  hashPassword,
  hashToken,
  isAllowedEmail,
  newSessionToken,
  normalizeEmail,
  passwordProblem,
  readCookie,
  sessionCookie,
  verifyPassword,
} from "../services/auth";

const router: IRouter = Router();

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
    .where(and(eq(sessionsTable.id, await hashToken(token)), gt(sessionsTable.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
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
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres. Log in." });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash: await hashPassword(password), lastLoginAt: new Date() })
    .returning();
  await startSession(req, res, user.id);
  res.status(201).json({ user: publicUser(user) });
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

/** Every API route after this one needs a logged-in user. */
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
