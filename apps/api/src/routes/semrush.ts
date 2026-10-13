import { Router, type IRouter } from "express";
import {
  GetSeoResearchParams,
  GetSeoResearchResponse,
  RunSeoResearchParams,
  RunSeoResearchResponse,
} from "@yellowlime/api-zod";
import {
  getBriefing,
  getSeoResearch,
  queueSeoResearch,
  upsertPendingSeoResearch,
} from "../services/seoResearch";

const router: IRouter = Router();

router.get("/briefings/:briefingId/seo-research", async (req, res): Promise<void> => {
  const parsed = GetSeoResearchParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige briefing." });
    return;
  }
  const briefing = await getBriefing(parsed.data.briefingId);
  if (!briefing) {
    res.status(404).json({ error: "Briefing niet gevonden." });
    return;
  }
  const research = await getSeoResearch(parsed.data.briefingId);
  res.json(GetSeoResearchResponse.parse(research ?? null));
});

router.post("/briefings/:briefingId/seo-research", async (req, res): Promise<void> => {
  const parsed = RunSeoResearchParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige briefing." });
    return;
  }
  const briefing = await getBriefing(parsed.data.briefingId);
  if (!briefing) {
    res.status(404).json({ error: "Briefing niet gevonden." });
    return;
  }
  const pending = await upsertPendingSeoResearch(briefing);
  queueSeoResearch(briefing, req.log);
  res.status(202).json(RunSeoResearchResponse.parse(pending));
});

export default router;