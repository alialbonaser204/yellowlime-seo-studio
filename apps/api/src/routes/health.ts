import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@yellowlime/api-zod";
import { db } from "@yellowlime/db";

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

export default router;
