import { Router, type IRouter } from "express";
import {
  GetTopicIdeasBody,
  GetTopicIdeasParams,
  GetTopicIdeasResponse,
  GetTopicThemesParams,
  GetTopicThemesResponse,
} from "@yellowlime/api-zod";
import { claudeErrorMessage } from "../services/claudePartnerProfile";
import { topicIdeas, topicThemes } from "../services/topicIdeas";

const router: IRouter = Router();

router.get("/partners/:partnerId/topic-themes", async (req, res): Promise<void> => {
  const params = GetTopicThemesParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  const result = await topicThemes(params.data.partnerId);
  if (!result) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
  res.set("Cache-Control", "no-store");
  res.json(GetTopicThemesResponse.parse(result));
});

router.post("/partners/:partnerId/topic-ideas", async (req, res): Promise<void> => {
  const params = GetTopicIdeasParams.safeParse(req.params);
  const body = GetTopicIdeasBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Ongeldige aanvraag." }); return; }
  try {
    const result = await topicIdeas(params.data.partnerId, body.data);
    if (!result) { res.status(404).json({ error: "Partner niet gevonden." }); return; }
    res.json(GetTopicIdeasResponse.parse(result));
  } catch (error) {
    req.log.warn({ code: "topic_ideas_failed", reason: error instanceof Error ? error.message.slice(0, 200) : typeof error }, "Topic ideas failed");
    const code = error instanceof Error ? error.message : "";
    res.status(502).json({
      error: code === "invalid_claude_json"
        ? "Limey gaf een onleesbaar antwoord. Probeer het nog een keer."
        : code === "claude_timeout"
          ? "Limey had te veel tijd nodig. Probeer het nog een keer, of kies een specifieker thema."
          : claudeErrorMessage(error),
    });
  }
});

export default router;
