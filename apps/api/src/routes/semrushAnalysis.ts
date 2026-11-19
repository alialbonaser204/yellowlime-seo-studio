import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, partnersTable, semrushAnalysesTable } from "@yellowlime/db";
import { analyseDomain, rootDomain, type DomainAnalysis } from "../services/domainAnalysis";
import { runMcpReport, safeSemrushError } from "../services/semrush";
import { currentUser } from "../lib/requestUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function partnerIdFrom(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function findPartner(id: number) {
  const [partner] = await db
    .select({ id: partnersTable.id, companyName: partnersTable.companyName, websiteUrl: partnersTable.websiteUrl })
    .from(partnersTable)
    .where(eq(partnersTable.id, id));
  return partner ?? null;
}

const toResponse = (row: typeof semrushAnalysesTable.$inferSelect) => ({
  id: row.id,
  domain: row.domain,
  createdAt: row.createdAt,
  analysis: row.data as DomainAnalysis,
});

/** The latest saved analysis (null when there is none yet). Costs no units. */
router.get("/partners/:partnerId/semrush-analysis", async (req, res): Promise<void> => {
  const id = partnerIdFrom(req.params.partnerId);
  const partner = id ? await findPartner(id) : null;
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const [row] = await db.select().from(semrushAnalysesTable)
    .where(eq(semrushAnalysesTable.partnerId, partner.id))
    .orderBy(desc(semrushAnalysesTable.createdAt)).limit(1);
  res.set("Cache-Control", "no-store");
  res.json(row ? toResponse(row) : null);
});

/** Runs a new analysis in Semrush (about 800 units) and saves it. */
router.post("/partners/:partnerId/semrush-analysis", async (req, res): Promise<void> => {
  const id = partnerIdFrom(req.params.partnerId);
  const partner = id ? await findPartner(id) : null;
  if (!partner) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  let domain: string;
  try {
    domain = rootDomain(partner.websiteUrl);
  } catch {
    res.status(400).json({ error: "De website van deze partner is geen geldig adres." });
    return;
  }
  try {
    const analysis = await analyseDomain(domain, (report, params) => runMcpReport(report, params));
    const [row] = await db.insert(semrushAnalysesTable).values({
      partnerId: partner.id,
      domain,
      data: analysis,
      createdBy: currentUser()?.id ?? null,
    }).returning();
    res.status(201).json(toResponse(row));
  } catch (error) {
    const safe = safeSemrushError(error);
    logger.warn({ partnerId: partner.id, domain, code: safe.code }, "Semrush analysis failed");
    res.status(502).json({ error: safe.message, code: safe.code });
  }
});

export default router;
