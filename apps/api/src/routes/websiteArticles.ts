import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  CheckTopicBody,
  CheckTopicParams,
  CheckTopicResponse,
  ListWebsiteArticlesParams,
  ListWebsiteArticlesResponse,
  ScanWebsiteArticlesParams,
  ScanWebsiteArticlesResponse,
} from "@yellowlime/api-zod";
import { db, partnersTable } from "@yellowlime/db";
import { checkTopic } from "../services/topicCheck";
import { latestScan, listWebsiteArticles, startWebsiteScan } from "../services/websiteScan";

const router: IRouter = Router();

router.get("/partners/:partnerId/website-articles", async (req, res): Promise<void> => {
  const params = ListWebsiteArticlesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ongeldige partner." });
    return;
  }
  const [partner] = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.id, params.data.partnerId));
  if (!partner) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  res.set("Cache-Control", "no-store");
  const [scan, articles] = await Promise.all([latestScan(partner.id), listWebsiteArticles(partner.id)]);
  res.json(ListWebsiteArticlesResponse.parse({ scan, articles }));
});

router.post("/partners/:partnerId/website-articles/scan", async (req, res): Promise<void> => {
  const params = ScanWebsiteArticlesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ongeldige partner." });
    return;
  }
  const scan = await startWebsiteScan(params.data.partnerId);
  if (!scan) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  res.status(202).json(ScanWebsiteArticlesResponse.parse(scan));
});

router.post("/partners/:partnerId/topic-check", async (req, res): Promise<void> => {
  const params = CheckTopicParams.safeParse(req.params);
  const body = CheckTopicBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Vul een onderwerp van minimaal 3 tekens in." });
    return;
  }
  const result = await checkTopic({ partnerId: params.data.partnerId, ...body.data });
  if (!result) {
    res.status(404).json({ error: "Partner niet gevonden." });
    return;
  }
  res.json(CheckTopicResponse.parse(result));
});

export default router;
