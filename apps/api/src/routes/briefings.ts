import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import {
  briefingsTable,
  db,
  partnersTable,
  yellowlimersTable,
} from "@yellowlime/db";
import {
  CreateBriefingBody,
  CreateBriefingResponse,
  ListBriefingsResponse,
} from "@yellowlime/api-zod";
import {
  queueSeoResearch,
  upsertPendingSeoResearch,
} from "../services/seoResearch";

const router: IRouter = Router();

router.get("/briefings", async (_req, res): Promise<void> => {
  const briefings = await db
    .select()
    .from(briefingsTable)
    .orderBy(asc(briefingsTable.createdAt));

  res.json(ListBriefingsResponse.parse(briefings));
});

router.post("/briefings", async (req, res): Promise<void> => {
  const parsed = CreateBriefingBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Ongeldige briefinggegevens");
    res.status(400).json({ error: "Vul alle verplichte velden in." });
    return;
  }

  const [partner] = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(eq(partnersTable.id, parsed.data.partnerId));

  if (!partner) {
    res.status(400).json({ error: "De geselecteerde partner bestaat niet." });
    return;
  }

  const [reviewer] = await db
    .select({ id: yellowlimersTable.id, active: yellowlimersTable.active })
    .from(yellowlimersTable)
    .where(eq(yellowlimersTable.id, parsed.data.reviewerId));

  if (!reviewer) {
    res.status(400).json({ error: "De geselecteerde Yellowlimer bestaat niet." });
    return;
  }

  if (!reviewer.active) {
    res.status(400).json({ error: "De geselecteerde Yellowlimer is niet actief." });
    return;
  }

  const [briefing] = await db
    .insert(briefingsTable)
    .values({
      partnerId: parsed.data.partnerId,
      reviewerId: parsed.data.reviewerId,
      subject: parsed.data.subject.trim(),
      contentGoal: parsed.data.contentGoal.trim(),
    })
    .returning();

  try {
    await upsertPendingSeoResearch(briefing);
    queueSeoResearch(briefing, req.log);
  } catch (error) {
    req.log.error(
      { code: "research_pending_failed", errorType: error instanceof Error ? error.name : typeof error },
      "SEO-onderzoek kon niet worden gestart",
    );
  }

  res.status(201).json(CreateBriefingResponse.parse(briefing));
});

export default router;