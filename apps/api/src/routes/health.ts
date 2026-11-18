import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@yellowlime/api-zod";
import { db } from "@yellowlime/db";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "../services/claudeRunner";
import { mailConfigured } from "../services/mailer";
import { defaultSemrushTransport, keywordMetrics, safeSemrushError, semrushMode } from "../services/semrush";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Checks the database connection. The error text never contains the connection string. */
router.get("/healthz/db", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ database: "ok" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(503).json({
      database: "error",
      type: error instanceof Error ? error.name : typeof error,
      code: (error as { code?: string })?.code ?? null,
      message: message.replace(/postgres(ql)?:\/\/\S+/gi, "<connection string>").slice(0, 300),
    });
  }
});

/** Which settings are present (never their values) and whether Claude answers. */
router.get("/healthz/ai", async (_req, res) => {
  const present = (name: string) => Boolean(process.env[name]?.trim());
  const settings = Object.fromEntries(
    ["DATABASE_URL", "ANTHROPIC_API_KEY", "SEMRUSH_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].map((n) => [n, present(n)]),
  );
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ settings, claude: "error", code: "missing_key" });
    return;
  }
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    await client.messages.create({ model: CLAUDE_MODEL, max_tokens: 5, messages: [{ role: "user", content: "Antwoord alleen met: ok" }] });
    res.json({ settings, claude: "ok", model: CLAUDE_MODEL });
  } catch (error) {
    // Only the status and Anthropic's error type and message; never the key.
    const status = (error as { status?: number }).status ?? null;
    const body = (error as { error?: { error?: { type?: string; message?: string } } }).error?.error;
    res.status(503).json({
      settings,
      claude: "error",
      model: CLAUDE_MODEL,
      status,
      type: body?.type ?? (error instanceof Error ? error.name : "unknown"),
      message: (body?.message ?? (error instanceof Error ? error.message : "")).replace(/sk-ant-\S+/g, "<key>").slice(0, 300),
    });
  }
});

/** Whether e-mail verification is active (never the values). */
router.get("/healthz/mail", (_req, res) => {
  const present = (name: string) => Boolean(process.env[name]?.trim());
  res.json({
    settings: { MAIL_FROM: present("MAIL_FROM"), BREVO_API_KEY: present("BREVO_API_KEY"), EMAIL_VERIFICATION: process.env.EMAIL_VERIFICATION?.trim() ?? null },
    mailConfigured: mailConfigured(),
    verificationOn: process.env.EMAIL_VERIFICATION?.trim().toLowerCase() === "on" && mailConfigured(),
  });
});

/** Does one small Semrush lookup to show whether the connection works (no key shown). */
router.get("/healthz/semrush", async (_req, res) => {
  const keyPresent = Boolean(process.env.SEMRUSH_API_KEY?.trim());
  const started = Date.now();
  if (!keyPresent) {
    res.json({ keyPresent, mode: semrushMode(), ok: false, code: "invalid_key", message: "SEMRUSH_API_KEY ontbreekt." });
    return;
  }
  try {
    const rows = await keywordMetrics(defaultSemrushTransport, ["fiets"], "nl");
    res.json({ keyPresent, mode: semrushMode(), ok: true, rows: rows.length, ms: Date.now() - started });
  } catch (error) {
    const safe = safeSemrushError(error);
    res.json({ keyPresent, mode: semrushMode(), ok: false, code: safe.code, message: safe.message, ms: Date.now() - started });
  }
});

export default router;
