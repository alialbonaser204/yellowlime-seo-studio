import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@yellowlime/api-zod";
import { db } from "@yellowlime/db";
import { defaultClaudeTextRunner } from "../services/claudeRunner";

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
  try {
    await defaultClaudeTextRunner("Antwoord alleen met: ok", 30_000);
    res.json({ settings, claude: "ok" });
  } catch (error) {
    res.status(503).json({ settings, claude: "error", code: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
  }
});

export default router;
